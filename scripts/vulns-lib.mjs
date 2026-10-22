// 脆弱性の記録(docs/security/vulns.md)を読み、Dependabot の開いている通知と突き合わせる。CLI は vulns.mjs。
// 通知と非公開の下書きは引数で受け取る(テストで差し替えるため。gh を呼ぶのは CLI だけ)。
// 決まりは docs/guides/vulnerabilities.md。

export const RESULTS = ["該当なし", "入っているが届かない", "届く・直した"];
const NEEDS_REVIEW = ["入っているが届かない"];
const COLUMNS = 6;

const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");

/** 「2026-10-22」の形か */
export const isDate = (s) => {
  const [y, m, d, ...rest] = String(s).split("-");
  return rest.length === 0 && y?.length === 4 && m?.length === 2 && d?.length === 2
    ? isDigits(y) && isDigits(m) && isDigits(d)
    : false;
};

const isIdChar = (c) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "-";

/**
 * 文の中の勧告の ID(GHSA-… / CVE-…)を、大文字にそろえて重なりなしで返す。
 * リンク([GHSA-…](https://…/GHSA-…))でもよい。正規表現は使わない(Semgrep の regex_dos に当たらないように)
 */
export function idsIn(text) {
  const ids = new Set();
  let word = "";
  for (const c of `${text ?? ""} `) {
    if (isIdChar(c)) {
      word += c;
      continue;
    }
    const upper = word.toUpperCase();
    if (upper.startsWith("GHSA-") || upper.startsWith("CVE-")) ids.add(upper);
    word = "";
  }
  return [...ids];
}

/** 表の1行を { cells } に。表の行でなければ undefined */
const cellsOf = (raw) => {
  const line = raw.trim();
  if (!line.startsWith("|") || !line.endsWith("|")) return undefined;
  return line
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
};

function checkRow(row, problems) {
  const where = `${row.line}行目`;
  if (row.ids.length === 0) problems.push(`${where} ID(GHSA-… か CVE-…)が無い`);
  if (!RESULTS.includes(row.result))
    problems.push(`${where} 結果「${row.result}」は ${RESULTS.join(" / ")} のどれか`);
  if (row.review === undefined && NEEDS_REVIEW.includes(row.result))
    problems.push(`${where} 「${row.result}」には見直す日(YYYY-MM-DD)が要る`);
  if (!row.reason) problems.push(`${where} 理由が無い`);
}

/**
 * 記録の表を読む。日付で始まる表の行だけを記録として扱う(見出し・区切りの行は飛ばす)。
 * 見直す日は日付か「—」(要らない)。
 */
export function parseVulns(text) {
  const rows = [];
  const problems = [];
  String(text)
    .split("\n")
    .forEach((raw, i) => {
      const cells = cellsOf(raw);
      if (!cells || !isDate(cells[0])) return;
      if (cells.length !== COLUMNS) {
        problems.push(`${i + 1}行目 列の数が${COLUMNS}ではない(${cells.length})`);
        return;
      }
      const [date, id, pkg, result, reason, reviewCell] = cells;
      const review = isDate(reviewCell) ? reviewCell : undefined;
      if (!review && reviewCell !== "—")
        problems.push(`${i + 1}行目 見直す日「${reviewCell}」は YYYY-MM-DD か —`);
      const row = { line: i + 1, date, ids: idsIn(id), pkg, result, reason, review };
      checkRow(row, problems);
      rows.push(row);
    });
  return { rows, problems };
}

/** ID ごとのいちばん新しい記録(同じ日なら下の行)。記録は足すだけなので、見直したら行を足す */
export function latestById(rows) {
  const latest = new Map();
  for (const row of rows) {
    for (const id of row.ids) {
      const before = latest.get(id);
      if (!before || before.date <= row.date) latest.set(id, row);
    }
  }
  return latest;
}

const alertIds = (alert) => idsIn(`${alert.ghsa ?? ""} ${alert.cve ?? ""}`);

/** 非公開の下書き(Security Advisory)の文に、この通知の ID が書いてあるか */
const inDrafts = (alert, drafts) => {
  const ids = new Set(drafts.flatMap((d) => idsIn(`${d.summary ?? ""} ${d.description ?? ""}`)));
  return alertIds(alert).some((id) => ids.has(id));
};

/**
 * 通知と記録を突き合わせる。
 * alerts が undefined(gh が無い・権限が無い)なら、通知の側は確かめずに記録の見直す日だけを見る。
 *   untriaged … 記録にも非公開の下書きにも無い通知(まだ精査していない)
 *   privately … 非公開の下書きで扱っている通知(届く・まだ直していない。中身はリポジトリに書かない)
 *   recorded  … 記録がある、開いたままの通知(届かない → 閉じるのは人の OK の後。直した → 版が上がったか確かめる)
 *   due       … 見直す日が来た・過ぎた記録(ID ごとのいちばん新しい行だけ)
 */
export function triage({ rows, alerts, drafts = [], today }) {
  const latest = latestById(rows);
  const untriaged = [];
  const privately = [];
  const recorded = [];
  for (const alert of alerts ?? []) {
    const row = alertIds(alert)
      .map((id) => latest.get(id))
      .find(Boolean);
    if (row) recorded.push({ alert, row });
    else if (inDrafts(alert, drafts)) privately.push(alert);
    else untriaged.push(alert);
  }
  const due = [...new Set(latest.values())].filter((r) => r.review && r.review <= today);
  return { untriaged, privately, recorded, due };
}
