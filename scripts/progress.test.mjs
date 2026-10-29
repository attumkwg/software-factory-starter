import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptanceOf,
  childrenOf,
  closesOf,
  END,
  median,
  orderProblems,
  progressOf,
  renderBlock,
  renderSummary,
  STALL_DAYS,
  START,
  withBlock,
} from "./progress-lib.mjs";

const body = [
  "要約: タスクの期限",
  "",
  "## 子 Issue(順番つき)",
  "1. #12 スキーマを足す",
  "2. #13 API(待つ: #12)",
  "- [ ] #14 画面(待つ: #12・#13)",
  "- [x] #15 手引き",
  "",
  "仕様の PR: #11 を見る(箇条書きでない行は子に数えない)",
].join("\n");

test("親の本文から子と待つ相手を読む(番号つき・箇条書き・チェックボックス。囲いの中は読まない)", () => {
  const kids = childrenOf(body);
  assert.deepEqual(
    kids.map((c) => [c.number, c.waits]),
    [
      [12, []],
      [13, [12]],
      [14, [12, 13]],
      [15, []],
    ],
  );
  assert.equal(kids[1].title, "API");
  const withOld = `${body}\n\n${START}\n- #99 古い進み具合\n${END}\n`;
  assert.equal(childrenOf(withOld).length, 4);
  assert.deepEqual(childrenOf("子はまだ無い"), []);
});

test("依存の問題: 一覧に無い子を待つ・輪になっている", () => {
  assert.deepEqual(orderProblems(childrenOf(body)), []);
  const bad = childrenOf("- #1 a(待つ: #2)\n- #2 b(待つ: #1)\n- #3 c(待つ: #9)");
  const problems = orderProblems(bad);
  assert.ok(problems.some((p) => p.includes("#9 は子の一覧に無い")));
  assert.ok(problems.some((p) => p.includes("輪になっている")));
});

test("PR の本文の Closes / Fixes / Resolves の番号", () => {
  assert.deepEqual(closesOf("Closes #12\nfixes #13・resolved #14・親: #10"), [12, 13, 14]);
  assert.deepEqual(closesOf("- Closes #"), []);
});

const now = new Date("2026-10-29T09:00:00+09:00");
const issue = (state, extra = {}) => ({
  state,
  created_at: "2026-10-20T00:00:00Z",
  closed_at: null,
  ...extra,
});
const parent = { number: 10, title: "タスクの期限", body, created_at: "2026-10-19T00:00:00Z" };

test("進み具合: n/m・次に進められる子・待つ子・止まった PR と、PR の無い子", () => {
  const issues = new Map([
    [12, issue("closed", { closed_at: "2026-10-24T00:00:00Z" })],
    [13, issue("open")],
    [14, issue("open")],
    [15, issue("closed", { closed_at: "2026-10-21T00:00:00Z" })],
  ]);
  const p = progressOf({ parent, issues, prs: [], now });
  assert.equal(`${p.done}/${p.total}`, "2/4");
  assert.equal(p.status, "進行中");
  assert.deepEqual(p.ready, [13]);
  assert.deepEqual(p.waiting, [{ number: 14, on: [13] }]);
  assert.equal(p.stalled.length, 1, "#13 は進められるのに PR が無い");
  assert.match(p.stalled[0].why, /PR が無い/);
  assert.equal(p.days, 10);

  const fresh = { number: 50, body: "Closes #13", updated_at: "2026-10-28T20:00:00Z" };
  assert.equal(progressOf({ parent, issues, prs: [fresh], now }).stalled.length, 0);
  const old = { number: 51, body: "Closes #13", updated_at: "2026-10-25T00:00:00Z" };
  const stalled = progressOf({ parent, issues, prs: [old], now }).stalled;
  assert.equal(stalled.length, 1);
  assert.equal(stalled[0].pr, 51);
  assert.ok(stalled[0].days >= STALL_DAYS);
});

test("完成の判定: 子が全部閉じて受け入れ待ち → 受け入れの記録があれば完成。日数は受け入れの日まで", () => {
  const all = new Map([12, 13, 14, 15].map((n) => [n, issue("closed")]));
  assert.equal(progressOf({ parent, issues: all, prs: [], now }).status, "受け入れ待ち");
  const done = progressOf({
    parent,
    issues: all,
    prs: [],
    accepted: { path: "docs/acceptance/0001-due.md", date: "2026-10-27" },
    now,
  });
  assert.equal(done.status, "完成");
  assert.equal(done.days, 7);
  assert.equal(
    progressOf({ parent: { ...parent, body: "なし" }, issues: all, prs: [], now }).status,
    "子の一覧が無い",
  );
});

test("受け入れの記録から、親 Issue と最後の回の日付", () => {
  const md = "# 受け入れ: 期限\n\n> 親 Issue: #10\n\n## 第1回 2026-10-26\n\n## 第2回 2026-10-27\n";
  assert.deepEqual(acceptanceOf(md), { parent: 10, date: "2026-10-27" });
  assert.equal(acceptanceOf("> 親 Issue: #").parent, undefined);
});

test("親の本文の囲いを差し替える(無ければ足す・2回目も1つ)", () => {
  const issues = new Map([
    [12, issue("closed")],
    [13, issue("open")],
    [14, issue("open")],
    [15, issue("closed")],
  ]);
  const p = progressOf({ parent, issues, prs: [], now });
  const block = renderBlock(p, "2026-10-29");
  assert.match(block, /\*\*2\/4\*\*・進行中・依頼から 10 日/);
  assert.match(block, /次に進められる: #13/);
  assert.match(block, /#14 は #13 を待つ/);
  const once = withBlock(body, block);
  const twice = withBlock(once, block);
  assert.equal(once, twice);
  assert.equal(twice.split(START).length, 2);
  assert.ok(twice.startsWith("要約: タスクの期限"));
});

test("一覧と、届くまでの日数の中央値(閉じた親も入れる・無ければ「まだ」)", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), undefined);
  const a = {
    number: 1,
    title: "A",
    status: "進行中",
    done: 1,
    total: 3,
    days: 4,
    ready: [2],
    stalled: [],
  };
  const b = { ...a, number: 2, status: "完成", days: 6 };
  const text = renderSummary([a], "2026-10-29", [a, b]);
  assert.match(text, /\| #1 A \| 1\/3 \| 進行中 \| 4 \| #2 \| 0 \|/);
  assert.match(text, /中央値\): 6 日/);
  assert.match(renderSummary([], "2026-10-29"), /はありません[\s\S]*中央値\): まだ/);
});
