// 週の数字(pnpm metrics)のテスト。node --test scripts/metrics/*.test.mjs
// GitHub は偽物(GraphQL の答えを組み立てる)。決まりは docs/designs/0035-delivery-metrics.md の 6。
import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_LABEL } from "./ai-assisted.mjs";
import { referencedSpecs } from "./collect.mjs";
import {
  buildReport,
  deployFact,
  fullWeeks,
  humanCommits,
  incidentFact,
  leadTimeHours,
  median,
  prFacts,
  questionsOf,
  specFact,
  specInventory,
  weekOf,
} from "./lib.mjs";
import { renderMarkdown } from "./render.mjs";

const MARKERS = ["Generated with [Claude Code]", "Co-Authored-By: Claude"];
const AI_COMMIT = {
  message: "直す\n\nCo-Authored-By: Claude Opus 5.5 <x>",
  parents: 1,
  authorName: "a",
  authorEmail: "a@x",
};
const HUMAN_COMMIT = { message: "手で直した", parents: 1, authorName: "a", authorEmail: "a@x" };
const MERGE_COMMIT = {
  message: "Merge branch 'main'",
  parents: 2,
  authorName: "a",
  authorEmail: "a@x",
};
const BOT_COMMIT = {
  message: "VRT の撮り直し",
  parents: 1,
  authorName: "github-actions[bot]",
  authorEmail: "41898282+github-actions[bot]@users.noreply.github.com",
};

const body = (rows) =>
  [
    "## 🧭 全体像",
    "- 何か",
    "## 🧑‍⚖️ 人に判断してほしい所",
    "| # | 種類 | 設計した事実 | なぜそうしたか | 人が判断する問い |",
    "|---|---|---|---|---|",
    ...rows,
    "## 🔎 観点ごとの扱い",
    "| 観点 | 扱い | 理由 |",
    "|---|---|---|",
    "| 業務ルール | 最重要 | x |",
  ].join("\n");

test("週は日本時間の月曜から。数え終わった週だけ(今週は入れない)", () => {
  assert.equal(weekOf("2026-10-25"), "2026-10-19"); // 日曜
  assert.equal(weekOf("2026-10-18T15:30:00Z"), "2026-10-19"); // 日本時間の月曜 0:30
  assert.equal(weekOf("2026-10-18T14:59:00Z"), "2026-10-12");
  assert.deepEqual(fullWeeks("2026-10-25", 2), ["2026-10-05", "2026-10-12"]);
  assert.deepEqual(fullWeeks("2026-10-19", 1), ["2026-10-12"]);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, null, 4, 3]), 2.5);
  assert.equal(median([]), null);
});

test("人が答えた問い: 「人に判断してほしい所」の表の行。空の行・「なし」は0", () => {
  assert.deepEqual(
    questionsOf(body(["| 1 | 事業判断 | a | b | c |", "| 2 | 戻せないリスク | a | b | c |"])),
    { count: 2, kinds: ["事業判断", "戻せないリスク"] },
  );
  assert.equal(questionsOf(body(["| | | | | |"])).count, 0); // テンプレートのまま
  assert.equal(questionsOf("## 🧑‍⚖️ 人に判断してほしい所\n\nなし。\n\n## 次").count, 0);
  assert.equal(questionsOf("本文なし").count, 0);
});

test("人の手直し: マージのコミット・ボット・AI の印つきを除いたコミット", () => {
  assert.equal(
    humanCommits([AI_COMMIT, HUMAN_COMMIT, MERGE_COMMIT, BOT_COMMIT, HUMAN_COMMIT], MARKERS),
    2,
  );
  assert.equal(humanCommits([], MARKERS), 0);
});

test("PR の事実: AI はラベルで見分ける(本文の印やコミットではない)。題名・本文・名前を持たない", () => {
  const pr = {
    number: 7,
    createdAt: "2026-10-13T00:00:00Z",
    mergedAt: "2026-10-13T06:00:00Z",
    body: `${body(["| 1 | 事業判断 | a | b | c |"])}\nGenerated with [Claude Code]`,
    author: "someone",
    authorType: "User",
    labels: ["risk:medium", "area:api"],
    commits: [AI_COMMIT],
  };
  const notLabeled = prFacts(pr, MARKERS);
  assert.equal(notLabeled.ai, false);
  const f = prFacts({ ...pr, labels: [...pr.labels, AI_LABEL] }, MARKERS);
  assert.equal(f.ai, true);
  assert.equal(f.risk, "medium");
  assert.equal(f.questions, 1);
  assert.equal(f.humanCommits, 0);
  assert.equal(f.openToMergeHours, 6);
  assert.equal(f.week, "2026-10-12");
  assert.equal(JSON.stringify(f).includes("someone"), false);
  assert.equal(prFacts({ ...pr, author: "renovate", authorType: "Bot" }, MARKERS).bot, true);
});

test("デプロイ: 成功(次に替わった物も)・失敗・終わっていない物を分ける。リードタイムはマージの後の最初の成功まで", () => {
  assert.deepEqual(deployFact({ createdAt: "2026-10-14T01:00:00Z", latestStatus: "SUCCESS" }), {
    at: "2026-10-14T01:00:00Z",
    week: "2026-10-12",
    ok: true,
  });
  assert.equal(
    deployFact({ createdAt: "2026-10-14T01:00:00Z", latestStatus: "INACTIVE" }).ok,
    true,
  );
  assert.equal(
    deployFact({ createdAt: "2026-10-14T01:00:00Z", latestStatus: "FAILURE" }).ok,
    false,
  );
  assert.equal(deployFact({ createdAt: "2026-10-14T01:00:00Z", latestStatus: "WAITING" }), null);
  const deploys = [
    { at: "2026-10-13T03:00:00Z", ok: true }, // マージより前
    { at: "2026-10-14T00:00:00Z", ok: false },
    { at: "2026-10-14T06:00:00Z", ok: true },
  ];
  const pr = { createdAt: "2026-10-13T00:00:00Z", mergedAt: "2026-10-13T06:00:00Z" };
  assert.equal(leadTimeHours(pr, deploys), 30);
  assert.equal(leadTimeHours({ ...pr, mergedAt: "2026-10-15T00:00:00Z" }, deploys), null);
});

test("振り返り: 「戻るまで」「変更が原因」の行を読む。無ければ null", () => {
  assert.deepEqual(
    incidentFact(
      "docs/incidents/2026-10-14-save-failed.md",
      "# x\n\n- 重さ: S2\n- 戻るまで: 26分(10:05〜10:31)\n- 変更が原因: はい(直前のデプロイ)\n",
    ),
    {
      file: "docs/incidents/2026-10-14-save-failed.md",
      date: "2026-10-14",
      week: "2026-10-12",
      minutes: 26,
      change: true,
    },
  );
  const blank = incidentFact("docs/incidents/2026-10-15-x.md", "# x\n- 変更が原因: いいえ\n");
  assert.equal(blank.minutes, null);
  assert.equal(blank.change, false);
  assert.equal(incidentFact("docs/incidents/README.md", ""), null);
});

test("仕様の在庫: 承認済みで、docs の外から指されていない物。下書きは承認待ち", () => {
  const specs = [
    specFact("docs/specs/0001-a.md", "# 仕様: 完了した物\n\n> 状態: 完了(例)\n"),
    specFact(
      "docs/specs/0002-b.md",
      "# 仕様: 作った物\n\n> 状態: 承認済み(承認した人: @x 2026-10-01)\n",
    ),
    specFact(
      "docs/specs/0003-c.md",
      "# 仕様: まだ作っていない物\n\n> 状態: 承認済み(承認した人: @x 2026-10-15)\n",
    ),
    specFact("docs/specs/0004-d.md", "# 仕様: 書いている物\n\n> 状態: 下書き\n"),
  ];
  const referenced = referencedSpecs(
    ["apps/api/src/x.ts", "docs/designs/0003-c.md", "scripts/y.mjs"],
    (f) =>
      ({
        "apps/api/src/x.ts": "// docs/designs/0002-b.md の 6",
        "docs/designs/0003-c.md": "仕様 0003", // docs の中は数えない
        "scripts/y.mjs": "// 設計書 0001",
      })[f],
  );
  assert.deepEqual([...referenced].sort(), ["0001", "0002"]);
  assert.deepEqual(specInventory(specs, referenced, "2026-10-25"), {
    ready: [{ number: "0003", title: "まだ作っていない物", days: 10 }],
    drafts: [{ number: "0004", title: "書いている物", days: null }],
  });
});

const pr = (over) => ({
  number: 1,
  bot: false,
  ai: true,
  risk: "low",
  questions: 0,
  kinds: [],
  humanCommits: 0,
  createdAt: "2026-10-13T00:00:00Z",
  mergedAt: "2026-10-13T02:00:00Z",
  week: "2026-10-12",
  openToMergeHours: 2,
  ...over,
});

test("決裁用は週ごとにチームで1つの数。改善用は先週の PR ごと。ボットの PR は数えない", () => {
  const report = buildReport({
    prs: [
      pr({ number: 1 }),
      pr({ number: 2, questions: 1, kinds: ["事業判断"] }),
      pr({ number: 3, ai: false }),
      pr({ number: 4, bot: true, ai: false }),
      pr({ number: 5, humanCommits: 2, kinds: [] }),
      pr({
        number: 6,
        week: "2026-10-05",
        mergedAt: "2026-10-06T00:00:00Z",
        createdAt: "2026-10-05T00:00:00Z",
      }),
    ],
    deploys: [
      { at: "2026-10-13T04:00:00Z", week: "2026-10-12", ok: true },
      { at: "2026-10-14T04:00:00Z", week: "2026-10-12", ok: false },
      { at: "2026-10-15T04:00:00Z", week: "2026-10-12", ok: true },
    ],
    incidents: [{ file: "f", date: "2026-10-14", week: "2026-10-12", minutes: 30, change: true }],
    inventory: { ready: [{ number: "0003", title: "t", days: 3 }], drafts: [] },
    weeks: ["2026-10-05", "2026-10-12"],
    today: "2026-10-19",
  });
  const [before, last] = report.decision.weeks;
  assert.deepEqual(last, {
    week: "2026-10-12",
    deploys: 2,
    leadTimeHours: 4, // 1・2・3・5 とも 10-13 00:00 に開いて 04:00 に出た
    changeFailurePct: 67, // 失敗のデプロイ1+変更が原因の障害1 / 試した3
    restoreMinutes: 30,
    merged: 4,
    botMerged: 1,
    aiPct: 75,
    aiUntouchedPct: 33, // AI の 1・2・5 のうち、問いも手直しも無いのは 1 だけ
  });
  assert.equal(before.merged, 1);
  assert.equal(before.leadTimeHours, 196); // 10-05 に開いて、最初の成功は 10-13 04:00
  assert.equal(before.changeFailurePct, null); // デプロイが無い週
  assert.deepEqual(report.decision.specsReady, 1);
  assert.deepEqual(
    report.improvement.prs.map((p) => p.number),
    [1, 2, 3, 5],
  );
  assert.deepEqual(report.improvement.kinds, [{ kind: "事業判断", count: 1 }]);
  const md = renderMarkdown(report);
  assert.match(md, /## 決裁用/);
  assert.match(md, /## 改善用\(2026-10-12 の週/);
  assert.match(md, /- 事業判断: 1件/);
  assert.match(md, /- 0003 t\(3日\)/);
});
