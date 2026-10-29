// 無人化率【推定】(pnpm metrics の1列)のテスト。node --test scripts/metrics/*.test.mjs
// 式は docs/kit/roi.md の 2 と同じ(docs/cost/people.yaml の分)。決まりは docs/designs/0094-weekly-unmanned-rate.md。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadPeopleConfig } from "../cost/source-people.mjs";
import { prFactOf } from "../roi-lib.mjs";
import { toPr } from "./collect.mjs";
import { buildReport, prFacts, unmannedOf } from "./lib.mjs";
import { renderMarkdown } from "./render.mjs";

const AI_COMMIT = { message: "直す\n\nCo-Authored-By: Claude Opus 5.5 <x>", parents: 1 };
const HUMAN_COMMIT = { message: "手で直した", parents: 1, authorName: "a", authorEmail: "a@x" };
const body = (rows) =>
  [
    "## 🧑‍⚖️ 人に判断してほしい所",
    "| # | 種類 | 設計した事実 | なぜそうしたか | 人が判断する問い |",
    "|---|---|---|---|---|",
    ...rows,
    "## 🔎 観点ごとの扱い",
  ].join("\n");

/** buildReport に渡す PR の事実(prFacts の形) */
const pr = (over) => ({
  number: 1,
  bot: false,
  ai: true,
  risk: "low",
  questions: 0,
  kinds: [],
  humanCommits: 0,
  aiAny: true,
  comments: 0,
  reviews: 0,
  minutes: { low: 15, high: 15, byHand: 120 },
  createdAt: "2026-10-13T00:00:00Z",
  mergedAt: "2026-10-13T02:00:00Z",
  week: "2026-10-12",
  openToMergeHours: 2,
  ...over,
});

const CONFIG = loadPeopleConfig(readFileSync("docs/cost/people.yaml", "utf8"));
const rawPr = (number, over = {}) => ({
  number,
  createdAt: "2026-10-13T00:00:00Z",
  mergedAt: "2026-10-13T02:00:00Z",
  body: "Generated with [Claude Code]",
  author: "owner",
  authorType: "User",
  labels: [],
  comments: 0,
  reviewers: [],
  commits: [AI_COMMIT],
  ...over,
});
const questionRows = (n) =>
  Array.from({ length: n }, (_, i) => `| ${i + 1} | 事業判断 | a | b | c |`);
const marked = (rows) => `${body(rows)}\nGenerated with [Claude Code]`;

test("無人化率: PR 1件の分は people.yaml の分。AI の PR はラベルか本文の印で見分け、名前は持たない", () => {
  const f = (over) => prFacts(rawPr(1, over), CONFIG);
  // AI の PR(印だけ・ラベルなし): 確かめる 15分 + コメント 2件 × 3分。全部を人が書いたら 120 + 6
  const byMark = f({ comments: 2 });
  assert.equal(byMark.ai, false); // 「AI が手伝った」はラベルだけ(今までどおり)
  assert.equal(byMark.aiAny, true);
  assert.deepEqual(byMark.minutes, { low: 21, high: 21, byHand: 126 });
  // 問い2つは、人の工数の上の端(= 無人化率の低い方)に 2 × 5分
  assert.deepEqual(f({ body: marked(questionRows(2)) }).minutes, {
    low: 15,
    high: 25,
    byHand: 120,
  });
  // 人が書いた PR は 120分のまま(全部を人が書いたらと同じ)
  assert.deepEqual(f({ body: "手で書いた" }).minutes, { low: 120, high: 120, byHand: 120 });
  // ボットの PR は 5分(コメントは数えない)。GraphQL のボットは login に [bot] が付かない
  const bot = f({ author: "renovate", authorType: "Bot", body: "", comments: 3 });
  assert.equal(bot.bot, true);
  assert.deepEqual(bot.minutes, { low: 5, high: 5, byHand: 5 });
  // ほかの人のレビューは 20分。作った人自身・ボットのレビューは数えない
  const reviewed = f({
    reviewers: [
      { login: "other-person", type: "User" },
      { login: "owner", type: "User" },
      { login: "coderabbitai", type: "Bot" },
    ],
  });
  assert.deepEqual(reviewed.minutes, { low: 35, high: 35, byHand: 140 });
  assert.equal(reviewed.reviews, 1);
  assert.equal(JSON.stringify(reviewed).includes("other-person"), false);
  assert.equal(JSON.stringify(reviewed).includes("owner"), false);
});

test("無人化率: 同じ PR から、週の数字と pnpm kpi --roi が同じ分を出す(コメントはどちらもボットを除く)", () => {
  // 週の数字は GraphQL の検索の形、kpi --roi は gh pr list --json の形で読む
  const node = {
    number: 9,
    createdAt: "2026-10-20T00:00:00Z",
    mergedAt: "2026-10-20T03:00:00Z",
    body: `${marked(questionRows(2))}\n- 取り組み: 基盤\n- 作業の種類: 保守\n- 動かす KPI: なし`,
    author: { login: "owner", __typename: "User" },
    labels: { nodes: [] },
    comments: {
      pageInfo: { hasNextPage: false },
      nodes: [
        { author: { login: "owner", __typename: "User" } },
        { author: { login: "github-actions", __typename: "Bot" } },
        { author: { login: "other-person", __typename: "User" } },
      ],
    },
    reviews: {
      pageInfo: { hasNextPage: false },
      nodes: [{ author: { login: "other-person", __typename: "User" } }],
    },
    commits: { nodes: [] },
  };
  const json = {
    number: 9,
    author: { login: "owner", is_bot: false },
    labels: [],
    body: node.body,
    // gh の JSON では、Actions の要約は login が github-actions で [bot] も is_bot も付かない
    comments: [
      { author: { login: "owner" } },
      { author: { login: "github-actions" } },
      { author: { login: "other-person" } },
    ],
    reviews: [{ author: { login: "other-person" } }],
    mergedAt: node.mergedAt,
  };
  const weekly = prFacts(toPr(node), CONFIG);
  const roi = prFactOf(json, { config: CONFIG, stages: {} });
  // 15分 + 人のコメント 2 × 3分 + ほかの人のレビュー 20分 = 41分。上の端は 問い 2 × 5分
  assert.deepEqual(weekly.minutes, { low: 41, high: 51, byHand: 146 });
  assert.deepEqual(roi.minutes, { low: weekly.minutes.low, high: weekly.minutes.high });
  assert.equal(weekly.comments, 2);
  assert.equal(toPr(node).overflow, false);
  assert.equal(
    toPr({ ...node, reviews: { ...node.reviews, pageInfo: { hasNextPage: true } } }).overflow,
    true,
  );
});

test("無人化率: キット自身の数え(roi.md の 2)と同じ数になる。181本・ボット4本・コメント24件・問い337 → 79〜87%", () => {
  const prs = [
    ...Array.from({ length: 181 }, (_, i) =>
      rawPr(i + 1, {
        comments: i < 24 ? 1 : 0,
        body: i < 119 ? marked(questionRows(i < 99 ? 3 : 2)) : "Generated with [Claude Code]",
        commits: i < 2 ? [HUMAN_COMMIT] : [AI_COMMIT],
      }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      rawPr(300 + i, { author: "renovate", authorType: "Bot", body: "" }),
    ),
  ].map((p) => prFacts(p, CONFIG));
  assert.deepEqual(unmannedOf(prs), {
    prs: { ai: 181, human: 0, bot: 4 },
    questions: 337,
    comments: 24,
    reviews: 0,
    humanCommits: 2,
    hours: { low: 46.8, high: 74.9 }, // 2,807分(roi.md の 47時間)・2,807 + 337 × 5 = 4,492分(75時間)
    byHandHours: 363.5, // 181 × 120 + 4 × 5 + 24 × 3 = 21,812分(364時間)
    pct: { low: 79, high: 87 },
  });
});

test("無人化率: PR の無い週・ボットの PR だけの週は —。人の工数が全部を人が書いたらを超える幅は 0% で止める", () => {
  assert.equal(unmannedOf([]).pct, null);
  const bot = prFacts(rawPr(1, { author: "renovate", authorType: "Bot", body: "" }), CONFIG);
  assert.equal(unmannedOf([bot]).pct, null); // 0% と出さない
  const many = prFacts(rawPr(1, { body: marked(questionRows(30)) }), CONFIG);
  assert.deepEqual(unmannedOf([many]).pct, { low: 0, high: 88 }); // 15 + 150 > 120
  const report = buildReport({
    prs: [pr({ week: "2026-10-12" }), pr({ number: 2, week: "2026-10-19" })], // 今週の物は合計に入れない
    deploys: [],
    incidents: [],
    inventory: { ready: [], drafts: [] },
    weeks: ["2026-10-05", "2026-10-12"],
    today: "2026-10-20",
    config: CONFIG,
  });
  assert.equal(report.decision.weeks[0].unmanned.pct, null);
  assert.deepEqual(report.decision.unmanned.prs, { ai: 1, human: 0, bot: 0 });
  assert.equal(report.decision.unmanned.rule.question, 5);
  const md = renderMarkdown(report);
  assert.match(md, /\| 2026-10-05 \| — \| 0時間 \| 0時間 \| 0・0・0 \| 0・0・0・0 \|/);
  assert.match(md, /\| 2026-10-12 \| 88% \| 0\.3時間 \| 2時間 \| 1・0・0 \| 0・0・0・0 \|/);
  assert.match(md, /AI の PR × 15分 \+ 人の PR × 120分/);
  assert.match(md, /人の工数の上の端\(= 無人化率の低い方\)に、問い1つ × 5分を足す/);
  assert.match(md, /ボットの PR が多い週は無人化率が少し下がる/);
});
