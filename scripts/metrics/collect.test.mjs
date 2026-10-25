// 週の数字の集め方(偽物の GitHub)と、AI の手伝いの見分け方のテスト。node --test scripts/metrics/*.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AI_LABEL, aiMarkersOf, isAiAssisted } from "./ai-assisted.mjs";
import { collectDeploys, collectPrs } from "./collect.mjs";
import { renderMarkdown } from "./render.mjs";
import { collectReport } from "./run.mjs";

const MARKERS = ["Generated with [Claude Code]", "Co-Authored-By: Claude"];
const body = () => "## 🧭 全体像\n- 何か\n## 🧑‍⚖️ 人に判断してほしい所\n\nなし。\n";

test("AI の手伝いの見分け: 本文の印(people.yaml と同じ)か、AI のボットが作った PR", () => {
  const markers = aiMarkersOf(readFileSync("docs/cost/people.yaml", "utf8"));
  assert.deepEqual(markers, MARKERS);
  assert.deepEqual(aiMarkersOf('ai_markers:\n  - "X" # 説明\nallocation: none\n'), ["X"]);
  assert.deepEqual(aiMarkersOf(""), MARKERS);
  assert.equal(
    isAiAssisted({ body: "…\nGenerated with [Claude Code]", author: "a", markers }),
    true,
  );
  assert.equal(isAiAssisted({ body: "", author: "claude[bot]", markers }), true);
  assert.equal(isAiAssisted({ body: "手で書いた", author: "a", markers }), false);
});

// ── 集め方(偽物の GitHub)──

const prNode = (number, over = {}) => ({
  number,
  createdAt: "2026-10-13T00:00:00Z",
  mergedAt: "2026-10-13T02:00:00Z",
  body: body(),
  author: { login: "secret-person", __typename: "User" },
  labels: { nodes: [{ name: AI_LABEL }] },
  commits: {
    nodes: [
      {
        commit: {
          message: "x",
          parents: { totalCount: 1 },
          author: { name: "secret-person", email: "p@x" },
        },
      },
    ],
  },
  ...over,
});

function fakeGh(pages, deployPages) {
  const calls = [];
  const gh = (query, vars) => {
    calls.push(vars);
    if (query.includes("search(")) {
      const i = vars.after ? Number(vars.after) : 0;
      return {
        ok: true,
        data: {
          search: {
            issueCount: pages.flat().length,
            pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: String(i + 1) },
            nodes: pages[i],
          },
        },
      };
    }
    const i = vars.after ? Number(vars.after) : 0;
    return {
      ok: true,
      data: {
        repository: {
          deployments: {
            pageInfo: { hasNextPage: i + 1 < deployPages.length, endCursor: String(i + 1) },
            nodes: deployPages[i],
          },
        },
      },
    };
  };
  return { gh, calls };
}

test("PR を頁ごとに読み、上限で切る。デプロイは新しい順に読み、古くなったら止める", () => {
  const { gh, calls } = fakeGh(
    [[prNode(1), prNode(2)], [prNode(3)]],
    [
      [{ createdAt: "2026-10-14T00:00:00Z", state: "ACTIVE", latestStatus: { state: "SUCCESS" } }],
      [
        {
          createdAt: "2026-09-01T00:00:00Z",
          state: "INACTIVE",
          latestStatus: { state: "INACTIVE" },
        },
      ],
      [
        {
          createdAt: "2026-08-01T00:00:00Z",
          state: "INACTIVE",
          latestStatus: { state: "INACTIVE" },
        },
      ],
    ],
  );
  const all = collectPrs(gh, "o/r", "2026-10-04", 10);
  assert.deepEqual(
    all.prs.map((p) => p.number),
    [1, 2, 3],
  );
  assert.equal(all.truncated, false);
  assert.match(calls[0].q, /^repo:o\/r is:pr is:merged merged:>=2026-10-04$/);
  const cut = collectPrs(gh, "o/r", "2026-10-04", 2);
  assert.deepEqual(
    cut.prs.map((p) => p.number),
    [1, 2],
  );
  assert.equal(cut.truncated, true);
  const d = collectDeploys(gh, "o/r", "prod", "2026-10-04");
  assert.deepEqual(
    d.deploys.map((x) => x.createdAt),
    ["2026-10-14T00:00:00Z"],
  );
  assert.equal(calls.filter((c) => c.env === "prod").length, 2); // 3頁目は読まない
});

test("集めた結果に人の名前・本文を出さない。GitHub が読めなくても、読めた物で作る", () => {
  const files = {
    "docs/cost/people.yaml": readFileSync("docs/cost/people.yaml", "utf8"),
    "docs/incidents/2026-10-14-x.md": "- 戻るまで: 10分\n- 変更が原因: いいえ\n",
    "docs/specs/0009-z.md": "# 仕様: z\n\n> 状態: 承認済み(@x 2026-10-10)\n",
  };
  const ctx = {
    repo: "o/r",
    today: "2026-10-19",
    read: (f) => files[f],
    files: (dir) => Object.keys(files).filter((f) => f.startsWith(`${dir}/`)),
  };
  const { gh } = fakeGh(
    [[prNode(1)]],
    [[{ createdAt: "2026-10-13T05:00:00Z", state: "ACTIVE", latestStatus: { state: "SUCCESS" } }]],
  );
  const report = collectReport({ ctx, gh, files: [], weeksCount: 1, environment: "prod" });
  assert.equal(report.decision.weeks[0].merged, 1);
  assert.equal(report.decision.weeks[0].leadTimeHours, 5);
  assert.equal(report.improvement.prs[0].humanCommits, 1);
  assert.equal(report.decision.specsReady, 1);
  const text = JSON.stringify(report) + renderMarkdown(report);
  assert.equal(text.includes("secret-person"), false);
  assert.equal(text.includes("全体像"), false);

  const broken = collectReport({
    ctx,
    gh: () => ({ ok: false, message: "HTTP 401" }),
    files: [],
    weeksCount: 1,
    environment: "prod",
  });
  assert.equal(broken.decision.weeks[0].merged, 0);
  assert.equal(broken.notes.length, 2);
  assert.match(broken.notes[0], /マージした PR を読めなかった/);
});
