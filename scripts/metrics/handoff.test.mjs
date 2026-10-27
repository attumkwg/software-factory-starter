// 週の数字の「引き渡し」(handoff.mjs)のテスト。決まりは docs/designs/0077-handoff-metrics.md の 6。
import assert from "node:assert/strict";
import { test } from "node:test";
import { readAcceptance } from "../acceptance-lib.mjs";
import {
  acceptanceFact,
  buildHandoff,
  handoffWeeks,
  implementationPrs,
  reworkFacts,
} from "./handoff.mjs";
import { renderMarkdown } from "./render.mjs";
import { collectHandoff } from "./run.mjs";

const HEAD =
  "| # | 観点 | 見る人 | 項目 | 結果 | 外れた理由 | 書き戻し先 |\n|---|---|---|---|---|---|---|";
const RECORD = [
  "# 受け入れ: タスクの承認",
  "> 実装の PR: #12, #13",
  "## 第1回 2026-10-21",
  HEAD,
  "| 1 | 流れ | PdM | 承認まで終わる | 合 | | |",
  "| 2 | ルール | PdM | 2段で承認 | 否 | 要求 | R-1 |",
  "| 3 | 状態 | AI | 状態 × 操作 | 合 | | |",
  "| 4 | 境界値 | QA | 上限 | 未 | | |",
  "## 第2回 2026-10-23",
  HEAD,
  "| 1 | ルール | PdM | 2段で承認 | 合 | | |",
].join("\n");
const rounds = () => readAcceptance([{ path: "docs/acceptance/0001-a.md", text: RECORD }]).rounds;
// 12 は 2026-10-14(火)の日本時間 10時・13 は 10-16 の日本時間 23時(UTC では 14時)
const MERGED = new Map([
  [12, "2026-10-14T01:00:00Z"],
  [13, "2026-10-16T14:00:00Z"],
]);

test("記録の頭から実装の PR の番号を取る", () => {
  assert.deepEqual(implementationPrs(RECORD), [12, 13]);
  assert.deepEqual(implementationPrs("> 実装の PR: #"), []);
  assert.deepEqual(implementationPrs("# 受け入れ"), []);
});

test("待ちは第1回だけ・最後にマージした日(日本時間)から数える", () => {
  const [first, second] = rounds();
  const a = acceptanceFact(first, [12, 13], MERGED);
  assert.equal(a.waitDays, 5); // 10-16(日本時間)→ 10-21
  assert.equal(a.week, "2026-10-19");
  assert.equal(a.ok, 2);
  assert.equal(a.judged, 3);
  assert.equal(a.pdm, 0.5);
  assert.deepEqual(a.reasons, { 要求: 1, 設計: 0, "AI の仮決め": 0, 実装: 0 });
  assert.equal(acceptanceFact(second, [12, 13], MERGED).waitDays, null);
});

test("読めない実装の PR があれば待ちは数えない(印を付ける)", () => {
  const a = acceptanceFact(rounds()[0], [12, 99], MERGED);
  assert.equal(a.waitDays, null);
  assert.equal(a.unread, true);
});

test("設計書の作り直しの記録の行を、入った工程ごとに読む", () => {
  const text = [
    "## 12. 未確定事項",
    "| U-1 | 設計 | 事業判断 | a | b | c | 仮決め |",
    "## 13. 作り直しの記録",
    "| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |",
    "|---|---|---|---|---|",
    "| 2026-10-20 | 受け入れ | 設計 | 4 | コード |",
    "| 2026-10-22 | レビュー | 実装 | x | テスト |",
    "| きのう | 何か | 設計 | x | x |",
    "## 14. ほかの節",
    "| 2026-10-21 | 別の表 | 設計 | x | x |",
  ].join("\n");
  assert.deepEqual(reworkFacts([{ text }]), [
    { week: "2026-10-19", stage: "設計" },
    { week: "2026-10-19", stage: "実装" },
  ]);
  assert.deepEqual(
    reworkFacts([{ text: "11 で作り直しの記録に触れるだけ\n| 2026-10-20 | a | 設計 | x | x |" }]),
    [],
  );
});

test("週ごとに、待ちの中央値・点数・理由・設計が原因の割合を出す", () => {
  const facts = rounds().map((r) => acceptanceFact(r, [12, 13], MERGED));
  const rework = [
    { week: "2026-10-19", stage: "設計" },
    { week: "2026-10-19", stage: "実装" },
    { week: "2026-10-19", stage: "要求" },
  ];
  const [prev, week] = handoffWeeks(["2026-10-12", "2026-10-19"], { rounds: facts, rework });
  assert.deepEqual(prev, {
    week: "2026-10-12",
    rounds: 0,
    waitDays: null,
    acceptPct: null,
    reasons: { 要求: 0, 設計: 0, "AI の仮決め": 0, 実装: 0 },
    rework: 0,
    designReworkPct: null,
  });
  assert.equal(week.rounds, 2);
  assert.equal(week.waitDays, 5);
  assert.equal(week.acceptPct, 75); // 合 3 / 判定 4(未は入れない)
  assert.equal(week.reasons.要求, 1);
  assert.equal(week.rework, 3);
  assert.equal(week.designReworkPct, 33);
});

test("先週の回を並べ、読めない PR は読めなかった物に出す", () => {
  const facts = rounds().map((r) => acceptanceFact(r, [12, 13], MERGED));
  const h = buildHandoff(["2026-10-19"], { rounds: facts, rework: [], unreadPrs: [99] });
  assert.equal(h.last.length, 2);
  assert.equal(h.last[0].waitDays, 5);
  assert.equal("ok" in h.last[0], false);
  assert.match(h.notes[0], /#99/);
  const md = renderMarkdown({
    today: "2026-10-26",
    weeks: { from: "2026-10-19", to: "2026-10-19" },
    decision: { weeks: [], specsReady: 0, specsDraft: 0 },
    improvement: {
      week: "2026-10-19",
      prs: [],
      kinds: [],
      incidents: [],
      specs: { ready: [], drafts: [] },
    },
    handoff: h,
    notes: h.notes,
  });
  assert.match(md, /## 引き渡し/);
  assert.ok(
    md.includes("第1回(待ち 5日・PdM 50%・全体 67%・外れ 要求 1・設計 0・AI の仮決め 0・実装 0)"),
  );
  assert.ok(md.includes("| 2026-10-19 | 2 | 5日 | 75% |"));
});

test("ファイルと GitHub から集める(第1回の実装の PR だけを読む)", () => {
  const files = {
    "docs/acceptance/0001-a.md": RECORD,
    "docs/designs/0001-a.md":
      "## 13. 作り直しの記録\n| 2026-10-20 | 受け入れ | 設計 | 4 | コード |",
  };
  const ctx = {
    repo: "o/r",
    files: (dir) => Object.keys(files).filter((f) => f.startsWith(`${dir}/`)),
    read: (f) => files[f],
  };
  const asked = [];
  const gh = (_q, vars) => {
    asked.push(vars.n);
    return { ok: true, data: { repository: { pullRequest: { mergedAt: MERGED.get(vars.n) } } } };
  };
  const h = collectHandoff({ ctx, gh, weeks: ["2026-10-19"] });
  assert.deepEqual(asked, [12, 13]);
  assert.equal(h.weeks[0].waitDays, 5);
  assert.equal(h.weeks[0].designReworkPct, 100);
  assert.deepEqual(h.notes, []);
});
