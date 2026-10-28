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

// ── 人の答えの出どころ(G-61・仕様 0061)──────────────────────────────
// AI は「承認(@名前)」の形を自分で書ける。だから PR で状態を人の答えに変えた行は、人が GitHub に書いた
// コメントかレビューを指させ、CI(decision-evidence.mjs)がリンク先の書き手を確かめる。

// 人の答えとみなす状態(リンクが要る)。仮決めは AI が書く。取り下げは作り直しで問いが無くなったときに AI が書く
export const ANSWERS = ["承認", "変更", "保留", ADOPT];
// 書き込める人(公開のリポジトリでは誰でもコメントを書ける)
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const GITHUB = "https://github.com/";
// リンクの終わり(空白・括弧・句読点・表の区切り)
const URL_END = new Set([" ", "\t", ")", "）", "、", "。", "」", "|"]);
const LOGIN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";

/** 設計書の文章から、番号ごとの状態(U-1 → 状態の文)。列の数が違う行は数えない(書き方の問題は readDecisions が出す) */
export const statesOf = (text) => {
  const map = new Map();
  for (const raw of String(text ?? "").split("\n")) {
    const cells = cellsOf(raw);
    if (cells?.length === 7) map.set(cells[0], cells[6]);
  }
  return map;
};

/** PR で人の答えの状態になった行(前の版に無い・状態の文が変わった)。{ id, state } の並び */
export const changedAnswers = (baseText, headText) => {
  const before = statesOf(baseText);
  return [...statesOf(headText)]
    .filter(([id, state]) => before.get(id) !== state && ANSWERS.some((s) => state.startsWith(s)))
    .map(([id, state]) => ({ id, state }));
};

/** 状態の文の中の、GitHub のコメント・レビューへのリンク。無ければ undefined */
export const evidenceOf = (state) => {
  const at = state.indexOf(GITHUB);
  if (at < 0) return undefined;
  let end = at;
  while (end < state.length && !URL_END.has(state[end])) end += 1;
  const url = state.slice(at, end);
  const [path, hash = ""] = url.slice(GITHUB.length).split("#");
  const [owner, repo, kind, num] = path.split("/");
  if (!owner || !repo || !["pull", "issues"].includes(kind) || !isDigits(num ?? "")) {
    return undefined;
  }
  const types = [
    ["issuecomment-", "comment"],
    ["pullrequestreview-", "review"],
    ["discussion_r", "review_comment"],
  ];
  for (const [prefix, type] of types) {
    const id = hash.startsWith(prefix) ? hash.slice(prefix.length) : "";
    if (isDigits(id)) return { url, repo: `${owner}/${repo}`, number: Number(num), type, id };
  }
  return undefined;
};

/** 状態の文の最初の @名前(無ければ undefined) */
export const approverOf = (state) => {
  const at = state.indexOf("@");
  if (at < 0) return undefined;
  let end = at + 1;
  while (end < state.length && LOGIN_CHARS.includes(state[end])) end += 1;
  return end > at + 1 ? state.slice(at + 1, end) : undefined;
};

/**
 * 1行の答えの出どころを確かめる。問題の文の並び(空なら良い)。
 * row: { id, state }・evidence: evidenceOf の結果・item: リンク先(GitHub の API の形。読めなければ undefined)
 * repo: このリポジトリ・prNumber: この PR・designNumber: 設計書の番号(0061 など)
 */
export const evidenceProblems = ({ row, evidence, item, repo, prNumber, designNumber }) => {
  if (!evidence)
    return [
      `${row.id}: 人の答え(PR か Issue のコメント・レビュー)へのリンクが無い。人が GitHub に「${row.id} 承認」のように書き、その URL を状態に添える`,
    ];
  if (evidence.repo.toLowerCase() !== repo.toLowerCase())
    return [`${row.id}: リンクが別のリポジトリ(${evidence.repo})を指している`];
  if (!item) return [`${row.id}: リンク先(${evidence.url})が読めない`];
  const problems = [];
  const login = item.user?.login;
  if (!item.user || item.user.type === "Bot")
    problems.push(`${row.id}: リンク先はボット(@${login ?? "?"})が書いた。人の答えではない`);
  else if (!TRUSTED.has(item.author_association))
    problems.push(
      `${row.id}: リンク先の書き手 @${login} は書き込める人ではない(${item.author_association})`,
    );
  const named = approverOf(row.state);
  if (!named) problems.push(`${row.id}: 状態に答えた人(@名前)が無い`);
  else if (login && named.toLowerCase() !== login.toLowerCase())
    problems.push(`${row.id}: 状態の @${named} と、リンク先の書き手 @${login} が違う`);
  const body = String(item.body ?? "");
  if (!body.includes(row.id)) problems.push(`${row.id}: リンク先の本文に ${row.id} が無い`);
  if (evidence.number !== prNumber && !body.includes(designNumber))
    problems.push(
      `${row.id}: 別の PR・Issue の答えなら、本文に設計書の番号(${designNumber})も書く`,
    );
  return problems;
};

// ── 1人の間の会話の答え(仕様 0080)──────────────────────────────
// 1人で回している間(.github/setup.yml の ruleset.required_approvals が 0)は、持ち主が会話で返した答えも認める:
// Slack で頼んだ作業のスレッドの返事・Claude Code のチャットでの返事。状態の文に場所を書く
// (例: 承認(@名前 2026-10-29 Slack の返事)・承認(@名前 2026-10-29 会話で回答))。@名前 はリポジトリの持ち主。
// CI は会話の書き手を確かめられない(1人の間だけの割り切り。人が増えて承認数を 1 以上にすると、また GitHub の答えだけ)。

/** 状態の文が会話(Slack・チャット・会話)の答えを指すか */
export const conversationAnswerOf = (state) => /slack|チャット|会話/i.test(String(state ?? ""));

/** setup.yml の中身から、1人の間か(required_approvals が 0) */
export const soloFrom = (setupYaml) => {
  const m = String(setupYaml ?? "").match(/^\s*required_approvals:\s*(\d+)/m);
  return m !== null && Number(m[1]) === 0;
};

/** 会話の答えの行の問題(空なら良い)。owner はリポジトリの持ち主の名前 */
export const conversationAnswerProblems = ({ row, solo, owner }) => {
  if (!solo)
    return [
      `${row.id}: 会話(Slack・チャット)の答えを認めるのは1人の間だけ(承認数が 1 以上なので、GitHub のコメントかレビューを指す)`,
    ];
  const named = approverOf(row.state);
  if (!named) return [`${row.id}: 状態に答えた人(@名前)が無い`];
  if (named.toLowerCase() !== String(owner).toLowerCase())
    return [`${row.id}: 会話の答えを認めるのはリポジトリの持ち主(@${owner})だけ`];
  return [];
};
