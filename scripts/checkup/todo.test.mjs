// 台帳(todo.mjs と docs/checkup/todo.yaml)のテスト。node --test scripts/checkup/todo.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadChecks } from "./runner.mjs";
import {
  FILE,
  historyAppendOnly,
  loadLedger,
  reviewDue,
  selectItems,
  validateLedger,
} from "./todo.mjs";

const ledger = loadLedger(readFileSync(FILE, "utf8"));
const item = (over) => ({
  id: "x",
  title: "t",
  why: "w",
  if_ignored: "i",
  who: "human",
  phase: "setup",
  every: "once",
  verify: "manual",
  steps: ["やる"],
  severity: "normal",
  status: "open",
  history: [],
  source: "s",
  review_by: "2027-04-20",
  ...over,
});
const head = { started_on: "2026-10-17", owners: { responder: "@a", advisor: "@b" } };
const problemsOf = (...items) => validateLedger({ ...head, items }, ["vulns"]).join("\n");

test("台帳(docs/checkup/todo.yaml)は書き方の問題が無く、auto の確かめ方が全部ある", async () => {
  const checks = await loadChecks();
  assert.deepEqual(validateLedger(ledger, [...checks.keys()]), []);
});

test("台帳の全項目に「なぜ」と「放っておくと」がある・ask にはおすすめ・manual には手順", () => {
  for (const i of ledger.items) {
    assert.ok(i.why && i.if_ignored, i.id);
    if (i.verify === "ask") assert.ok(i.question.recommended, i.id);
    if (i.verify === "manual") assert.ok(i.steps.length > 0, i.id);
  }
});

test("世の中の変化の取り込みの調べる所が台帳にある(設計書 6. の初版)", () => {
  const names = ledger.refresh_sources.map((s) => s.name).join("・");
  for (const word of [
    "GitHub",
    "AWS",
    "Node.js",
    "OWASP",
    "IPA",
    "個人情報保護委員会",
    "Claude Code",
  ])
    assert.ok(names.includes(word), word);
});

test("refreshed_on と refresh_sources の形・引退の記録", () => {
  const text = validateLedger(
    { ...head, refreshed_on: "先月", refresh_sources: [{ name: "x", url: "http://a" }], items: [] },
    [],
  ).join("\n");
  assert.match(text, /refreshed_on/);
  assert.match(text, /refresh_sources の「x」/);
  assert.match(validateLedger({ ...head, refresh_sources: [], items: [] }).join(), /1件以上/);
  const retired = [{ on: "2026-11-24", by: "checkup-refresh", result: "retired", note: "不要" }];
  assert.equal(problemsOf(item({ status: "retired", history: retired })), "");
});

test("ソフトウェアで解けない「推奨」も載っている(人がやる・advisory)", () => {
  assert.ok(ledger.items.some((i) => i.who === "human" && i.advisory === true));
});

test("設計書の毎週の自動の確かめと、初版の項目が全部ある", () => {
  const ids = new Set(ledger.items.map((i) => i.id));
  const weekly = ["w-vuln", "w-renovate", "w-guards", "w-protection", "w-secrets"];
  for (const id of [...weekly, "w-minutes", "w-decisions", "w-ledger"]) assert.ok(ids.has(id), id);
  for (const id of ["gh-plan", "gh-protection", "acct-mfa", "legal-terms", "eol", "team-review"])
    assert.ok(ids.has(id), id);
  assert.equal(ledger.items.find((i) => i.id === "w-vuln").severity, "high");
});

test("書き方の問題: 必須の欄・値・確かめ方ごとの欄", () => {
  const text = problemsOf(
    item({ id: "a", why: "" }),
    item({ id: "b", phase: "3y", every: "daily" }),
    item({ id: "c", verify: "auto" }),
    item({ id: "d", verify: "auto", check: "nothing" }),
    item({ id: "e", steps: [] }),
    item({
      id: "f",
      verify: "ask",
      question: { text: "q", options: [{ label: "A", means: "m" }] },
    }),
    item({ id: "g", review_by: "来年" }),
    item({ id: "Bad_Id" }),
    item({ id: "a" }),
  );
  assert.match(text, /項目 a に why が無い/);
  assert.match(text, /項目 b の phase「3y」/);
  assert.match(text, /項目 b の every「daily」/);
  assert.match(text, /項目 c は auto なので check が要る/);
  assert.match(text, /項目 d の check「nothing」が scripts\/checkup\/checks\/ に無い/);
  assert.match(text, /項目 e は manual なので steps/);
  assert.match(text, /項目 f の選択肢は2〜4個/);
  assert.match(text, /項目 f のおすすめ/);
  assert.match(text, /項目 f の question.irreversible/);
  assert.match(text, /項目 g の review_by/);
  assert.match(text, /項目 Bad_Id の id/);
  assert.match(text, /項目 a が2回ある/);
});

test("選択肢の after・ask と manual の check・history の result は決まった値だけ", () => {
  const options = [
    { label: "A", means: "m", after: "later" },
    { label: "B", means: "m", after: "open" },
  ];
  const text = problemsOf(
    item({
      id: "a",
      verify: "ask",
      question: { text: "q", options, recommended: "A", irreversible: false },
    }),
    item({ id: "b", check: "nothing" }),
    item({ id: "c", check: "vulns", history: [{ on: "2026-10-22", by: "@a", result: "ok" }] }),
  );
  assert.match(text, /項目 a の選択肢の after「later」/);
  assert.doesNotMatch(text, /after「open」/);
  assert.match(text, /項目 b の check「nothing」が scripts\/checkup\/checks\/ に無い/);
  assert.match(text, /項目 c の history の result「ok」/);
  assert.doesNotMatch(text, /項目 c の check/);
});

test("今はやらない(snoozed)は次に聞く日が要り、最後の記録から90日まで", () => {
  const h = [{ on: "2026-10-22", by: "@a", result: "snoozed" }];
  const text = problemsOf(
    item({ id: "a", status: "snoozed" }),
    item({ id: "b", status: "snoozed", history: h, snoozed_until: "2027-03-01" }),
  );
  assert.match(text, /項目 a は snoozed なので snoozed_until が要る/);
  assert.match(text, /項目 b の snoozed_until は最後の記録から90日まで/);
  assert.equal(
    problemsOf(item({ status: "snoozed", history: h, snoozed_until: "2027-01-20" })),
    "",
  );
});

test("いま見る項目: 段階・状態・間隔で分ける", () => {
  const done = (on) => [{ on, by: "@a", result: "done" }];
  const items = [
    item({ id: "auto-done", verify: "auto", check: "vulns", status: "done" }),
    item({ id: "ask-open", verify: "ask" }),
    item({ id: "manual-open" }),
    item({ id: "later", phase: "1m" }),
    item({ id: "retired", status: "retired" }),
    item({ id: "advisor", status: "asked_advisor" }),
    item({ id: "snoozed", status: "snoozed", snoozed_until: "2026-11-01" }),
    item({ id: "snooze-over", status: "snoozed", snoozed_until: "2026-10-22" }),
    item({ id: "once-done", status: "done", history: done("2026-10-18") }),
    item({ id: "weekly-done", status: "done", every: "weekly", history: done("2026-10-15") }),
    item({ id: "monthly-done", status: "done", every: "monthly", history: done("2026-10-15") }),
  ];
  const s = selectItems({ ...head, items }, "setup", "2026-10-22");
  const ids = (list) => list.map((i) => i.id);
  assert.deepEqual(ids(s.checks), ["auto-done"]);
  assert.deepEqual(ids(s.ask), ["ask-open"]);
  assert.deepEqual(ids(s.manual), ["manual-open", "snooze-over", "weekly-done"]);
  assert.deepEqual(ids(s.advisor), ["advisor"]);
  assert.deepEqual(ids(s.snoozed), ["snoozed"]);
  assert.deepEqual(ids(s.done), ["once-done", "monthly-done"]);
});

test("見直す日が来た項目(引退した物は除く)", () => {
  const items = [
    item({ id: "a", review_by: "2026-10-22" }),
    item({ id: "b", review_by: "2026-10-23" }),
    item({ id: "c", review_by: "2026-01-01", status: "retired" }),
  ];
  assert.deepEqual(
    reviewDue({ items }, "2026-10-22").map((i) => i.id),
    ["a"],
  );
});

test("記録は足すだけ: 書き換え・消した項目は問題", () => {
  const h1 = [{ on: "2026-10-20", by: "checkup", result: "fail" }];
  const h2 = [...h1, { on: "2026-10-27", by: "@a", result: "done" }];
  const before = { items: [item({ id: "a", history: h1 }), item({ id: "b" })] };
  assert.deepEqual(
    historyAppendOnly(before, { items: [item({ id: "a", history: h2 }), item({ id: "b" })] }),
    [],
  );
  const rewritten = [{ ...h1[0], result: "pass" }];
  const text = historyAppendOnly(before, { items: [item({ id: "a", history: rewritten })] }).join(
    "\n",
  );
  assert.match(text, /項目 a の history が書き換わっている/);
  assert.match(text, /項目 b が消えている/);
});

test("main の台帳から、記録が足すだけになっている(main に台帳が無い・取れないときは飛ばす)", (t) => {
  let before;
  try {
    before = execFileSync("git", ["show", `origin/main:${FILE}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    t.skip("main の台帳を読めない");
    return;
  }
  assert.deepEqual(historyAppendOnly(loadLedger(before), ledger), []);
});
