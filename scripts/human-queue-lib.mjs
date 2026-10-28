// 人の判断待ちの積み場と、会話の答えの記録(中身だけ。読み書きは human-queue.mjs と pr-merge-when-green.mjs)。仕様 0085。
// 人が決めることの一覧は docs/concepts/human-decisions.md。
import { stripComments } from "./bets-lib.mjs";

/** 付いていたら人の答えを待つ印(PR・Issue) */
export const QUEUE_LABELS = ["needs-human", "risk:high", "tests:weakened"];

/** PR に1件で聞いてよい問いの数(1件の依頼で多くて2問。仕様 0084) */
export const MAX_QUESTIONS = 2;

/** 問い1つの長さの上限(1問1行。スマホで読める長さ) */
export const QUESTION_MAX_CHARS = 160;

/** 会話の答えを PR に残すコメントの頭(この形が無い PR は、まだ答えを待っている) */
export const ANSWER_MARK = "## 持ち主の承認(会話で";

const cellsOf = (line) => {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return undefined;
  return t
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
};

// 表の行のうち問いの行か(見出し・区切り・空・「なし」だけ・番号だけの行は問いではない)
const isQuestionRow = (cells) => {
  if (!cells || cells.every((c) => /^:?-+:?$/.test(c))) return false;
  if (cells.includes("人が判断する問い")) return false;
  const filled = cells.filter((c) => c !== "" && c !== "なし");
  return !(filled.length === 0 || (filled.length === 1 && /^\d+$/.test(filled[0])));
};

/**
 * PR の本文の「🧑‍⚖️ 人に判断してほしい所」の表の問いの並び({ kind, fact, question })。
 * 見出しの行・区切りの行・空の行・「なし」だけの行は数えない
 */
export function prQuestions(body) {
  const lines = stripComments(String(body ?? "")).split("\n");
  const start = lines.findIndex((l) => /^##\s*🧑‍⚖️/.test(l.trim()));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l.trim()));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .map(cellsOf)
    .filter(isQuestionRow)
    .map((cells) => ({ kind: cells[1] ?? "", fact: cells[2] ?? "", question: cells.at(-1) ?? "" }));
}

/** PR の本文の問いの問題(落とす物)と注意(知らせるだけ) */
export function prQuestionProblems(body) {
  const qs = prQuestions(body);
  const problems = [];
  const notes = [];
  if (qs.length > MAX_QUESTIONS)
    problems.push(
      `「🧑‍⚖️ 人に判断してほしい所」の問いが ${qs.length} つ。多くて ${MAX_QUESTIONS} つ(1問1行・選択肢つき。残りは AI が決めて設計書の「決めたこと」に理由を書く。docs/concepts/human-decisions.md)`,
    );
  qs.forEach((q, i) => {
    if (!q.question) problems.push(`問い ${i + 1}: 「人が判断する問い」が空`);
    else if (q.question.length > QUESTION_MAX_CHARS)
      notes.push(
        `問い ${i + 1} が ${q.question.length} 文字。1問1行(${QUESTION_MAX_CHARS} 文字まで)に縮め、理由は「なぜそうしたか」へ`,
      );
  });
  return { problems, notes, count: qs.length };
}

/**
 * 会話で答えた日時(持ち主がチャット・Slack で返した時刻)。ISO 8601 でタイムゾーンつきだけ認める。
 * 先の日時(5分の誤差まで)は断る。返すのは { at: Date } か { problem }
 */
export function answeredAtOf(text, now = new Date()) {
  const s = String(text ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s))
    return {
      problem: `答えた日時は ISO 8601 のタイムゾーンつき(例: 2026-10-29T09:15:00+09:00)。いま: ${s || "空"}`,
    };
  const at = new Date(s);
  if (Number.isNaN(at.getTime())) return { problem: `答えた日時が読めない: ${s}` };
  if (at.getTime() > now.getTime() + 5 * 60 * 1000)
    return { problem: `答えた日時が先の時刻: ${s}` };
  return { at };
}

/** 日本時間の「YYYY-MM-DD HH:MM」 */
export const tokyoTime = (date) =>
  new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

/**
 * 会話の答えを PR に残すコメント。reply は持ち主の言葉そのまま・reasons は人の答えが要る理由(危険度「高」など)・
 * questions はその領域の問い(docs/concepts/risk-areas.md)・sha は答えを当てた版
 */
export function answerComment({ reply, answeredAt, owner, where, reasons, questions, sha }) {
  const lines = [
    `${ANSWER_MARK}・${tokyoTime(answeredAt)} 日本時間)`,
    "",
    `- @${owner}(${where})「${reply.replaceAll("\n", " ")}」`,
    `- 当てた版: \`${sha.slice(0, 7)}\`(この版の必須のチェックが全部緑のときだけマージする)`,
  ];
  if (reasons.length > 0) lines.push(`- 人の答えが要った理由: ${reasons.join("・")}`);
  if (questions.length > 0) {
    lines.push("- この PR で人に聞いた問い(docs/concepts/risk-areas.md):");
    for (const q of questions) lines.push(`  - ${q}`);
  }
  lines.push(
    "",
    "1人の間の運用(仕様 0085・ADR 0085): 持ち主が会話で返した言葉をここに残し、工場(AI)がマージする。CI は会話の書き手を確かめない。",
  );
  return lines.join("\n");
}

/** コメントの並びに、会話の答えの記録があるか(sha を渡せばその版に当てた物だけ) */
export const hasAnswer = (comments, sha) =>
  comments.some(
    (c) =>
      String(c.body ?? "").startsWith(ANSWER_MARK) &&
      (sha === undefined || String(c.body).includes(`\`${sha.slice(0, 7)}\``)),
  );

const DAY = 24 * 3600 * 1000;
const daysSince = (iso, now) => Math.max(0, Math.floor((now - new Date(iso)) / DAY));

/**
 * 判断待ちの並び(古い順)。prs は開いた PR({ number, title, draft, labels, body, created_at, answered })、
 * issues は needs-human の Issue({ number, title, created_at })、verdicts は意義の判断で人の判定待ち({ path, title, by })
 */
export function queueItems({ prs = [], issues = [], verdicts = [], now = new Date() }) {
  const items = [];
  for (const pr of prs) {
    if (pr.draft || pr.answered) continue;
    const labels = pr.labels.filter((l) => QUEUE_LABELS.includes(l));
    const qs = prQuestions(pr.body);
    if (labels.length === 0 && qs.length === 0) continue;
    const why = [...labels, ...(qs.length > 0 ? [`問い ${qs.length}`] : [])].join("・");
    items.push({
      kind: "PR",
      ref: `#${pr.number}`,
      title: pr.title,
      why,
      ask: qs[0]?.question || "マージしてよいか(会話で「マージして」)",
      since: pr.created_at,
    });
  }
  for (const issue of issues)
    items.push({
      kind: "Issue",
      ref: `#${issue.number}`,
      title: issue.title,
      why: "needs-human",
      ask: "Issue の問いに答える",
      since: issue.created_at,
    });
  for (const v of verdicts)
    items.push({
      kind: "意義の判断",
      ref: v.path,
      title: v.title,
      why: "期限を過ぎて人の判定が未定",
      ask: "正しかった / 間違っていた(一言)",
      since: v.by,
    });
  return items
    .map((it) => ({ ...it, waitDays: daysSince(it.since, now) }))
    .sort((a, b) => b.waitDays - a.waitDays || String(a.ref).localeCompare(String(b.ref)));
}

/** Issue と Slack に出す積み場の本文(古い順・種類ごとの数・いちばん古い待ち) */
export function renderQueue(items, today) {
  const lines = [`# 🧑‍⚖️ 判断待ち(${today})`, ""];
  if (items.length === 0) {
    lines.push("判断待ちはありません。");
    return lines.join("\n");
  }
  const kinds = [...new Set(items.map((i) => i.kind))];
  const counts = kinds.map((k) => `${k} ${items.filter((i) => i.kind === k).length}件`);
  lines.push(
    `- ${items.length}件(${counts.join("・")})。いちばん古いのは ${items[0].waitDays} 日待ち`,
    "- 答えはチャットか Slack で返す。工場が PR に「会話で回答(日時つき)」と残して進める(docs/concepts/human-decisions.md)",
    "",
    "| 待ち | 種類 | 何 | 理由 | 問い |",
    "|---|---|---|---|---|",
  );
  for (const it of items) {
    const what = `${it.ref} ${it.title ?? ""}`.trim().replaceAll("|", "/").slice(0, 60);
    const ask = String(it.ask).replaceAll("|", "/").slice(0, QUESTION_MAX_CHARS);
    lines.push(`| ${it.waitDays}日 | ${it.kind} | ${what} | ${it.why} | ${ask} |`);
  }
  return lines.join("\n");
}

/** 積み場の Issue の題(1つだけを直し続ける) */
export const QUEUE_ISSUE_TITLE = "🧑‍⚖️ 判断待ち";
