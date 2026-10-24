// 未確定事項(docs/designs/*.md の「未確定事項」の表)を読んで分ける中身。入口は decisions.mjs。
// 書き方は docs/guides/human-review.md の 2・「導入時に決める」は docs/designs/0013-decisions-at-adoption.md。
// Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む。

export const KINDS = ["事業判断", "利用者の挙動", "他チームとの契約や制約", "戻せないリスク"];
export const ADOPT = "導入時に決める";
export const STATES = ["仮決め", "承認", "変更", "保留", "取り下げ", ADOPT];

const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");

// 「U-1」「U-12」のような番号か
const isDecisionId = (cell) => cell.startsWith("U-") && isDigits(cell.slice(2));

// 「保留(@名前: 2026-11-30 までに)」から「2026-11-30」を取り出す。無ければ undefined
export const dueDateOf = (state) => {
  const at = state.indexOf("までに");
  if (at < 0) return undefined;
  const date = state.slice(0, at).trimEnd().slice(-10);
  const [y, m, d] = date.split("-");
  const ok = y?.length === 4 && m?.length === 2 && d?.length === 2;
  return ok && isDigits(y) && isDigits(m) && isDigits(d) ? date : undefined;
};

// 表の1行(| … |)をセルに分ける。未確定事項の行でなければ undefined
const cellsOf = (raw) => {
  const line = raw.trim();
  if (!line.startsWith("|") || !line.endsWith("|")) return undefined;
  const cells = line
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
  return isDecisionId(cells[0]) ? cells : undefined;
};

// 行の状態ごとの決まり。問題の文を返す(無ければ undefined)
const stateProblem = (row, head, today) => {
  if (head === "保留") {
    const due = dueDateOf(row.state);
    if (!due) return `${row.where} ${row.id} の保留に期限(YYYY-MM-DD までに)が無い`;
    if (due < today) return `${row.where} ${row.id} の保留の期限(${due})が過ぎた`;
  }
  if (head === ADOPT && !row.state.includes("@")) {
    return `${row.where} ${row.id} の${ADOPT}に、キットの既定を承認した人(@名前)が無い`;
  }
  return undefined;
};

// 1行を読んで out に足す
const readRow = (cells, where, today, out) => {
  if (cells.length !== 7) {
    out.problems.push(`${where} 列の数が7ではない(${cells.length})`);
    return;
  }
  const [id, stage, kind, fact, , question, state] = cells;
  if (!KINDS.includes(kind)) {
    out.problems.push(
      `${where} ${id} の種類「${kind}」は4つのどれでもない(4つに当たらないなら「決めたこと」へ)`,
    );
  }
  const head = STATES.find((s) => state.startsWith(s));
  if (!head) {
    out.problems.push(`${where} ${id} の状態「${state}」は ${STATES.join(" / ")} で始めてください`);
    return;
  }
  const row = { where, id, stage, kind, fact, question, state, head };
  out.rows.push(row);
  const problem = stateProblem(row, head, today);
  if (problem) out.problems.push(problem);
};

// docs: [{ path, text }]。戻り値: { rows: [{ where, id, stage, kind, fact, question, state, head }], problems }
export const readDecisions = (docs, today) => {
  const out = { rows: [], problems: [] };
  for (const { path, text } of docs) {
    text.split("\n").forEach((raw, i) => {
      const cells = cellsOf(raw);
      if (cells) readRow(cells, `${path}:${i + 1}`, today, out);
    });
  }
  return out;
};

// 状態ごとに分ける
export const groupRows = (rows) => {
  const by = (head) => rows.filter((r) => r.head === head);
  return { open: by("仮決め"), adopt: by(ADOPT), deferred: by("保留") };
};

// 旗(strict / launch)から、1 で終わるかと、そのわけを出す。launch のほうが厳しい
export const verdict = ({ rows, problems }, { strict = false, launch = false } = {}) => {
  const { open, adopt } = groupRows(rows);
  if (launch && (open.length > 0 || adopt.length > 0 || problems.length > 0)) {
    return {
      fail: true,
      message: `❌ 公開の前に決める物が残っています(仮決め ${open.length}件・${ADOPT} ${adopt.length}件・書き方の問題 ${problems.length}件)。pnpm decisions --adopt と /tailor で決めてから公開してください。`,
    };
  }
  if ((strict || launch) && (open.length > 0 || problems.length > 0)) {
    return {
      fail: true,
      message:
        "❌ 仮決めか書き方の問題が残っています。人の答えをもらってから、マージしてください。",
    };
  }
  return { fail: false, message: launch ? "✅ 公開の前に決める物は残っていません。" : "" };
};

// 設計書のパス(行の where の「:」の前)ごとにまとめる
export const byDesign = (rows) => {
  const map = new Map();
  for (const r of rows) {
    const path = r.where.slice(0, r.where.lastIndexOf(":"));
    map.set(path, [...(map.get(path) ?? []), r]);
  }
  return map;
};

// --adopt の出し方(使う人の「決めることリスト」)。行の配列を返す
export const adoptLines = (rows) => {
  const adopt = groupRows(rows).adopt;
  const lines = [`🧭 ${ADOPT}(キットの既定のまま。あなたのプロダクトで決める): ${adopt.length}件`];
  for (const [path, list] of byDesign(adopt)) {
    lines.push("", `■ ${path}(${list.length}件)`);
    for (const r of list) {
      lines.push(`- ${r.id}(${r.kind})キットの既定: ${r.fact}`);
      lines.push(`    問い: ${r.question}  … ${r.where}`);
    }
  }
  lines.push(
    "",
    "決め方(人の答えをもらってから、状態の列だけを書き換える):",
    "- 既定のままでよい → 承認(@名前 YYYY-MM-DD)",
    "- 変える → 変更(@名前 YYYY-MM-DD: どう変えるか)にして /rework で設計書から作り直す",
    "まとめて1問ずつ聞くなら /tailor。本番に出す前に pnpm decisions --launch が通ることを確かめる。",
  );
  return lines;
};
