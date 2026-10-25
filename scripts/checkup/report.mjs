// 点検の結果を、詳しくない人が読める Markdown にする(画面に出す・のちに Issue の本文の元にする)。
// 公開のリポジトリなので、脆弱性や秘密の見つけ物の中身は出さない(確かめ方の note は件数と見る場所だけ)。
import { urgentOf } from "./runner.mjs";

/** 1問・1件にかかる時間の目安(分) */
export const MINUTES = { ask: 3, manual: 10 };
export const WHO_LABEL = { system: "仕組み", ai: "AI", human: "人" };
/** 1問ずつ答える入口 */
export const ANSWER_HOW = "Claude Code で /checkup";
/** 認証の準備の項目だけ(--area compliance)のときの入口 */
const ANSWER_HOW_AREA = { compliance: "Claude Code で /compliance-check" };

const who = (item) => `${WHO_LABEL[item.who] ?? item.who}${item.advisory ? "・推奨" : ""}`;

const resultLine = (r) => {
  const back = r.regressed ? "【守りが外れた】" : "";
  return `- ${back}${r.item.title} \`${r.item.id}\`(${who(r.item)})— ${r.note}\n  - なぜ: ${r.item.why}`;
};

const itemLine = (item, extra = "") =>
  `- ${item.title} \`${item.id}\`(${who(item)})${extra}\n  - なぜ: ${item.why}\n  - 放っておくと: ${item.if_ignored}`;

const section = (title, lines) => (lines.length === 0 ? [] : ["", `## ${title}`, "", ...lines]);

/** 冒頭の要約(何問答えるか・急ぎ・段階) */
export function headline(run) {
  const questions = run.ask.length + run.manual.length;
  const minutes = run.ask.length * MINUTES.ask + run.manual.length * MINUTES.manual;
  const urgent = urgentOf(run);
  const pass = run.results.filter((r) => r.result === "pass").length;
  const nextText = run.next
    ? `次の段階「${run.next.name}」は ${run.next.on} から`
    : "これが最後の段階";
  return [
    questions === 0
      ? "今週あなたが答えること: 答えることはありません"
      : `今週あなたが答えること: ${questions}問(約${minutes}分) → ${ANSWER_HOW_AREA[run.area] ?? ANSWER_HOW}`,
    urgent.length === 0
      ? "急ぎ: なし"
      : `急ぎ: ${urgent.length}件 — ${urgent.map((r) => r.item.title).join("・")}`,
    `自動で確かめて問題なし: ${pass}件`,
    `段階: ${run.phase.name}(使い始めて ${run.days + 1}日目)。${nextText}`,
  ];
}

/**
 * 結果の節(急ぎ → 落ちた → 確かめられなかった → 聞く → 手でやる → 相談先 → 今はやらない → 問題なし)。
 * opts.issue … Issue の本文にする(手でやる物をチェックボックスに・相談先を @ で呼ぶ)
 * opts.advisor … 相談先(@ 付きの名前)
 */
export function reportSections(run, opts = {}) {
  const failed = run.results.filter((r) => r.result === "fail");
  const urgent = urgentOf(run);
  const later = failed.filter((r) => !urgent.includes(r));
  const unknown = run.results.filter((r) => r.result === "unknown");
  const passed = run.results.filter((r) => r.result === "pass");
  const question = (i) => `
  - 問い: ${i.question.text}`;
  const steps = (i) => `
  - 手順は ${i.steps.length}つ(/checkup で番号付きで出す)`;
  const manualLine = (i) => {
    const line = itemLine(i, steps(i));
    return opts.issue ? line.replace("- ", "- [ ] ") : line;
  };
  const advisorHead =
    opts.issue && opts.advisor ? [`${opts.advisor} さんに答えてほしい物です。`, ""] : [];
  const advisorLines = run.advisor.map((i) => itemLine(i));
  return [
    ...section("🔴 急ぎ(守りが効いていない・重い穴・漏れ)", urgent.map(resultLine)),
    ...section("🟡 落ちた(急がない)", later.map(resultLine)),
    ...section("❔ 確かめられなかった(gh が無い・権限が無いなど)", unknown.map(resultLine)),
    ...section(
      "🙋 あなたに聞くこと",
      run.ask.map((i) => itemLine(i, question(i))),
    ),
    ...section("✋ あなたが手でやること", run.manual.map(manualLine)),
    ...section(
      "📮 相談先に回っている(「分からない」を選んだ物)",
      advisorLines.length === 0 ? [] : [...advisorHead, ...advisorLines],
    ),
    ...section(
      "💤 今はやらない",
      run.snoozed.map((i) =>
        itemLine(
          i,
          `
  - 次に聞く日: ${i.snoozed_until}`,
        ),
      ),
    ),
    ...section(
      "✅ 自動で確かめて問題なし",
      passed.map((r) => `- ${r.item.title} \`${r.item.id}\` — ${r.note}`),
    ),
  ];
}

export const footer = (run) =>
  `> 段階は使い始めた日(${run.startedOn})から数える。前の段階で済んでいない物は残る。台帳: docs/checkup/todo.yaml・1枚: docs/checkup/README.md`;

/** 結果の全文(Markdown) */
export function renderReport(run) {
  return [
    `# 点検 ${run.today}`,
    "",
    ...headline(run).map((l) => `- ${l}`),
    ...reportSections(run),
    "",
    footer(run),
    "",
  ].join("\n");
}
