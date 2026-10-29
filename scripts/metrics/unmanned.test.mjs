// 無人化率【推定】(pnpm metrics の1列)のテスト。node --test scripts/metrics/*.test.mjs
// 式は docs/kit/roi.md の 2 と同じ(docs/cost/people.yaml の分)。決まりは docs/designs/0094-weekly-unmanned-rate.md。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadPeopleConfig } from "../cost/source-people.mjs";
import { buildReport, prFacts, unmannedOf } from "./lib.mjs";
import { renderMarkdown } from "./render.mjs";

const MARKERS = ["Generated with [Claude Code]", "Co-Authored-By: Claude"];
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

test("無人化率: PR 1件の分は people.yaml の分。AI の PR はラベルか本文の印で見分け、名前は持たない", () => {
  const f = (over) => prFacts(rawPr(1, over), MARKERS, CONFIG);
  // AI の PR(印だけ・ラベルなし): 確かめる 15分 + コメント 2件 × 3分。全部を人が書いたら 120 + 6
  const marked = f({ comments: 2 });
  assert.equal(marked.ai, false); // 「AI が手伝った」はラベルだけ(今までどおり)
  assert.equal(marked.aiAny, true);
  assert.deepEqual(marked.minutes, { low: 21, high: 21, byHand: 126 });
  // 問い2つは幅の上の端に 2 × 5分
  assert.deepEqual(f({ body: `${body(questionRows(2))}\nGenerated with [Claude Code]` }).minutes, {
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
  assert.equal(JSON.stringify(reviewed).includes("other-person"), false);
  assert.equal(JSON.stringify(reviewed).includes("owner"), false);
});

test("無人化率: キット自身の数え(roi.md の 2)と同じ数になる。149本・ボット4本・コメント99件・問い305 → 78〜86%", () => {
  const prs = [
    ...Array.from({ length: 149 }, (_, i) =>
      rawPr(i + 1, {
        comments: i < 99 ? 1 : 0,
        body:
          i < 102
            ? `${body(questionRows(i < 101 ? 3 : 2))}\nGenerated with [Claude Code]`
            : "Generated with [Claude Code]",
        commits: i === 0 ? [HUMAN_COMMIT] : [AI_COMMIT],
      }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      rawPr(200 + i, { author: "renovate", authorType: "Bot", body: "" }),
    ),
  ].map((p) => prFacts(p, MARKERS, CONFIG));
  assert.deepEqual(unmannedOf(prs), {
    prs: { ai: 149, human: 0, bot: 4 },
    questions: 305,
    comments: 99,
    humanCommits: 1,
    hours: { low: 42.5, high: 68 }, // 2,552分・2,552 + 305 × 5 = 4,077分
    byHandHours: 303.3, // 149 × 120 + 4 × 5 + 99 × 3 = 18,197分
    pct: { low: 78, high: 86 },
  });
});

test("無人化率: PR の無い週は —。人の工数が全部を人が書いたらを超える幅は 0% で止める", () => {
  assert.equal(unmannedOf([]).pct, null);
  const many = prFacts(
    rawPr(1, { body: `${body(questionRows(30))}\nGenerated with [Claude Code]` }),
    MARKERS,
    CONFIG,
  );
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
  assert.match(md, /\| 2026-10-05 \| — \| 0時間 \| 0時間 \| 0・0・0 \| 0・0・0 \|/);
  assert.match(md, /\| 2026-10-12 \| 88% \| 0\.3時間 \| 2時間 \| 1・0・0 \| 0・0・0 \|/);
  assert.match(md, /AI の PR × 15分 \+ 人の PR × 120分/);
});
