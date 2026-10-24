// 知らせ(notify.mjs)のテスト。node --test scripts/checkup/notify.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { readEnv } from "./gh.mjs";
import {
  isoWeek,
  pendingIds,
  planUrgent,
  planWeekly,
  urgentIdOf,
  weeklyBody,
  weeklyIdsOf,
  weeklyTitle,
} from "./notify.mjs";

const item = (over) => ({
  title: `題 ${over.id}`,
  why: "なぜ",
  if_ignored: "放っておくと",
  who: "system",
  severity: "normal",
  status: "open",
  ...over,
});
const runOf = (over = {}) => ({
  today: "2026-10-26",
  startedOn: "2026-10-17",
  phase: { id: "setup", name: "立ち上げ" },
  days: 9,
  next: { id: "1m", name: "1か月", on: "2026-11-16" },
  results: [],
  ask: [],
  manual: [],
  advisor: [],
  snoozed: [],
  done: [],
  ...over,
});
const res = (id, result, over = {}) => ({
  item: item({ id, ...over }),
  result,
  note: `${id} の結果`,
  regressed: false,
});
const owners = { responder: "@resp", advisor: "@adv" };

test("ISO の週(月曜始まり。年の変わり目は木曜で決まる)", () => {
  assert.equal(isoWeek("2026-10-19"), "2026-W43");
  assert.equal(isoWeek("2026-10-25"), "2026-W43");
  assert.equal(isoWeek("2026-10-26"), "2026-W44");
  assert.equal(isoWeek("2026-12-31"), "2026-W53");
  assert.equal(isoWeek("2027-01-03"), "2026-W53");
  assert.equal(isoWeek("2027-01-04"), "2027-W01");
  assert.equal(isoWeek("2025-12-29"), "2026-W01");
  assert.equal(weeklyTitle("2026-10-26"), "点検 2026-W44");
});

test("何も起きていない週も知らせ、一番上は「答えることはありません」", () => {
  const body = weeklyBody(runOf({ results: [res("a", "pass")] }));
  assert.equal(body.split("\n")[0], "- 今週あなたが答えること: 答えることはありません");
  assert.match(body, /急ぎ: なし/);
  assert.match(body, /<!-- checkup:weekly ids= -->/);
});

test("手でやる物はチェックボックス(「やった」の印だけ)・相談先は @ で呼ぶ・残りは印に", () => {
  const manual = item({ id: "m", steps: ["1"], verify: "manual" });
  const advised = item({ id: "q", status: "asked_advisor" });
  const run = runOf({
    manual: [manual],
    advisor: [advised],
    results: [res("bad", "fail"), res("ok", "pass"), res("dunno", "unknown")],
  });
  const body = weeklyBody(run, { ...owners });
  assert.match(body, /- \[ \] 題 m `m`/);
  assert.match(body, /@adv さんに答えてほしい物です/);
  assert.match(body, /チェックボックスは「やった」の印だけ/);
  assert.deepEqual(pendingIds(run), ["m", "bad", "dunno"]);
  assert.deepEqual(weeklyIdsOf({ body }), ["m", "bad", "dunno"]);
  assert.doesNotMatch(body, /@resp さん/);
  assert.match(weeklyBody(run, { ...owners, assigned: false }), /@resp さん、今週の点検です/);
});

test("新しい週: 作って、前の週を閉じ、先週から残っている物を写す", () => {
  const run = runOf({ results: [res("still", "fail"), res("fixed", "pass")] });
  const issues = [
    {
      number: 3,
      title: "点検 2026-W43",
      state: "OPEN",
      body: "…\n<!-- checkup:weekly ids=still,fixed -->",
    },
    { number: 1, title: "点検 2026-W42", state: "CLOSED", body: "<!-- checkup:weekly ids=old -->" },
    { number: 2, title: "点検の急ぎ: x", state: "OPEN", body: "<!-- checkup:urgent id=x -->" },
  ];
  const actions = planWeekly({ run, issues, ...owners });
  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, "create");
  assert.equal(actions[0].title, "点検 2026-W44");
  assert.match(actions[0].body, /## ↩️ 先週から残っているもの\n\n- 題 still `still`\n/);
  assert.doesNotMatch(actions[0].body, /- 題 fixed `fixed`\n\n/);
  assert.deepEqual(actions[1], {
    type: "close",
    number: 3,
    comment: "次の週の点検(点検 2026-W44)に写しました。",
  });
});

test("同じ週にもう一度流したら、その週の Issue の本文を直す(増やさない)", () => {
  const issues = [
    { number: 5, title: "点検 2026-W44", state: "OPEN", body: "<!-- checkup:weekly ids=a -->" },
    { number: 4, title: "点検 2026-W43", state: "CLOSED", body: "<!-- checkup:weekly ids=b -->" },
  ];
  const actions = planWeekly({ run: runOf({ results: [res("b", "fail")] }), issues, ...owners });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "edit");
  assert.equal(actions[0].number, 5);
  assert.match(actions[0].body, /先週から残っているもの\n\n- 題 b `b`/);
});

test("急ぎ: high の fail だけ。1件1つ・開いていれば本文だけ直す・pass に戻ったら閉じる・unknown は閉じない", () => {
  const run = runOf({
    results: [
      res("new", "fail", { severity: "high" }),
      { ...res("again", "fail", { severity: "high" }), regressed: true },
      res("normal", "fail"),
      res("fixed", "pass", { severity: "high" }),
      res("dunno", "unknown", { severity: "high" }),
    ],
  });
  const open = (number, id) => ({
    number,
    state: "OPEN",
    body: `x\n<!-- checkup:urgent id=${id} -->\n`,
  });
  const actions = planUrgent({
    run,
    issues: [open(7, "again"), open(8, "fixed"), open(9, "dunno")],
  });
  assert.deepEqual(
    actions.map((a) => [a.type, a.number ?? a.title]),
    [
      ["create", "点検の急ぎ: 題 new"],
      ["edit", 7],
      ["close", 8],
    ],
  );
  assert.equal(actions[0].urgent, true);
  assert.match(actions[1].body, /🔴 【守りが外れた】題 again/);
  assert.match(actions[1].body, /最後に確かめた日: 2026-10-26/);
  assert.match(actions[2].comment, /直っていました/);
  assert.equal(urgentIdOf({ body: actions[0].body }), "new");
});

test("急ぎが無く、開いた急ぎの Issue も無ければ、何もしない", () => {
  assert.deepEqual(planUrgent({ run: runOf({ results: [res("a", "pass")] }), issues: [] }), []);
});

test("読むときだけ CHECKUP_READ_TOKEN を使う(書くトークンと分ける)", () => {
  assert.equal(readEnv({ GH_TOKEN: "w", CHECKUP_READ_TOKEN: "r" }).GH_TOKEN, "r");
  assert.equal(readEnv({ GH_TOKEN: "w" }).GH_TOKEN, "w");
});
