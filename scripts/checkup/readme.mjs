// 詳しくない人が読む1枚(docs/checkup/README.md)を、台帳から作る。手で書かない。
// 今日の日付や確かめた結果は入れない(台帳だけで決まる。置いてある物と作った物を比べてずれを見つけるため)。
import { addDays, PHASES, toDate } from "./phase.mjs";
import { WHO_LABEL } from "./report.mjs";

export const README = "docs/checkup/README.md";

const STATUS_LABEL = {
  open: "⬜ まだ",
  done: "✅ 済み",
  asked_advisor: "📮 相談中",
  snoozed: "💤 後で",
  retired: "🗄️ 引退",
};
const EVERY_LABEL = {
  once: "一度",
  weekly: "毎週",
  monthly: "毎月",
  quarterly: "四半期ごと",
  "half-year": "半年ごと",
  yearly: "毎年",
};
const VERIFY_LABEL = { auto: "自動で確かめる", ask: "人に聞く", manual: "人が手でやる" };

const status = (i) =>
  i.status === "snoozed"
    ? `${STATUS_LABEL.snoozed}(${toDate(i.snoozed_until)} に聞く)`
    : (STATUS_LABEL[i.status] ?? i.status);
const who = (i) => `${WHO_LABEL[i.who] ?? i.who}${i.advisory ? "・推奨" : ""}`;
const cell = (s) => String(s ?? "").replaceAll("|", "/");

const row = (i) =>
  `| ${status(i)} | ${cell(i.title)} \`${i.id}\` | ${who(i)} | ${EVERY_LABEL[i.every] ?? i.every} | ${VERIFY_LABEL[i.verify] ?? i.verify} | ${cell(i.why)} |`;

export function renderReadme(ledger) {
  const startedOn = toDate(ledger.started_on);
  const items = ledger.items ?? [];
  const phaseRows = PHASES.map((p) => {
    const n = items.filter((i) => i.phase === p.id).length;
    return `| ${p.name} | ${addDays(startedOn, p.from)} から(${p.from}日〜) | ${n}件 |`;
  });
  const phaseSections = PHASES.flatMap((p) => {
    const list = items.filter((i) => i.phase === p.id);
    if (list.length === 0) return [];
    return [
      "",
      `## ${p.name}(${addDays(startedOn, p.from)} から)`,
      "",
      "| 状態 | やること | 誰が | 間隔 | 確かめ方 | なぜ要るか |",
      "|---|---|---|---|---|---|",
      ...list.map(row),
    ];
  });
  return [
    "# 点検の台帳(1枚)",
    "",
    "> この1枚は [todo.yaml](todo.yaml)(台帳。ここが正)から `pnpm checkup --write-readme` で作る。手で直さない。",
    "> 状態は台帳に書いた最後の答え。「自動で確かめる」の今の結果は `pnpm checkup` で見る(台帳の状態を信じずに毎回確かめ直す)。",
    "> 「人に聞く」「人が手でやる」には、Claude Code で `/checkup` と打って1問ずつ答える(答えは台帳に書かれ、PR になる)。答えた流れの例: [examples/](examples/)",
    `> 使い始めた日: ${startedOn}・担当者: ${ledger.owners?.responder}・相談先: ${ledger.owners?.advisor}`,
    `> 世の中の変化の取り込み(月1回、Claude Code で \`/checkup-refresh\`): ${ledger.refreshed_on ? `前回 ${toDate(ledger.refreshed_on)}` : "まだ一度も流していない"}・調べる所 ${(ledger.refresh_sources ?? []).length}か所`,
    "> 誰が: 仕組み = 自動で済む / AI = AI が PR を出す / 人 = 担当者がやる(人・推奨 = ソフトウェアでは解けない。やるかは人が決める)",
    "",
    "## 段階(使い始めた日から数える。前の段階で済んでいない物は残る)",
    "",
    "| 段階 | いつから | 項目 |",
    "|---|---|---|",
    ...phaseRows,
    ...phaseSections,
    "",
  ].join("\n");
}
