// 答えを台帳に書く(answer.mjs)のテスト。node --test scripts/checkup/answer.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decide, writeAnswer } from "./answer.mjs";
import { FILE, historyAppendOnly, loadLedger, validateLedger } from "./todo.mjs";

const base = {
  title: "t",
  why: "w",
  if_ignored: "i",
  who: "human",
  phase: "setup",
  every: "once",
  severity: "normal",
  status: "open",
  history: [],
  source: "s",
  review_by: "2027-04-20",
};
const question = (over = {}) => ({
  text: "q",
  options: [
    { label: "やった", means: "m" },
    { label: "まだ", means: "m", after: "open" },
    { label: "あとで", means: "m", after: "snooze" },
  ],
  recommended: "やった",
  irreversible: false,
  ...over,
});
const ledger = {
  started_on: "2026-10-17",
  owners: { responder: "@Resp", advisor: "@adv" },
  items: [
    { ...base, id: "ask", verify: "ask", question: question() },
    { ...base, id: "money", verify: "ask", question: question({ irreversible: true }) },
    { ...base, id: "hand", verify: "manual", steps: ["やる"] },
    { ...base, id: "auto", verify: "auto", check: "x" },
    { ...base, id: "old", verify: "manual", steps: ["やる"], status: "retired" },
    { ...base, id: "advised", verify: "ask", question: question(), status: "asked_advisor" },
  ],
};
const today = "2026-10-24";
const answer = (over) => decide(ledger, { by: "@resp", today, ...over });

test("選んだ: 選択肢の after で状態が決まる(書かなければ済み・open はまた聞く・snooze は90日後)", () => {
  assert.deepEqual(answer({ id: "ask", kind: "pick", choice: "やった" }), {
    status: "done",
    entry: { on: today, by: "@resp", result: "answered", choice: "やった" },
  });
  assert.equal(answer({ id: "ask", kind: "pick", choice: "まだ" }).status, "open");
  const later = answer({ id: "ask", kind: "pick", choice: "あとで" });
  assert.equal(later.status, "snoozed");
  assert.equal(later.snoozed_until, "2027-01-22");
  assert.match(answer({ id: "ask", kind: "pick", choice: "無い" }).error, /選択肢「無い」が無い/);
});

test("選んだ・やったの後の確かめが fail なら済みにしない", () => {
  const checkResult = { result: "fail", note: "まだオフ" };
  const r = answer({ id: "ask", kind: "pick", choice: "やった", checkResult });
  assert.equal(r.status, "open");
  assert.equal(r.entry.note, "確かめ: fail(まだオフ)");
  assert.equal(answer({ id: "hand", kind: "did", checkResult }).status, "open");
  assert.equal(answer({ id: "hand", kind: "did" }).status, "done");
});

test("分からない: おすすめで仮に進めて相談先へ。戻せない問いは進めない(U-4)", () => {
  const r = answer({ id: "ask", kind: "unsure" });
  assert.equal(r.status, "asked_advisor");
  assert.equal(r.entry.choice, "やった");
  const money = answer({ id: "money", kind: "unsure" });
  assert.equal(money.status, "asked_advisor");
  assert.equal(money.entry.choice, undefined);
  assert.match(money.entry.note, /戻せない問い/);
  assert.equal(answer({ id: "hand", kind: "unsure" }).status, "asked_advisor");
});

test("今はやらない: 理由と、今日より後・90日までの日が要る", () => {
  const ok = answer({ id: "hand", kind: "snooze", until: "2026-11-24", note: "来月" });
  assert.deepEqual(ok, {
    status: "snoozed",
    snoozed_until: "2026-11-24",
    entry: { on: today, by: "@resp", result: "snoozed", note: "来月" },
  });
  assert.match(answer({ id: "hand", kind: "snooze", until: "2026-11-24" }).error, /理由/);
  assert.match(answer({ id: "hand", kind: "snooze", until: today, note: "x" }).error, /今日より後/);
  assert.match(
    answer({ id: "hand", kind: "snooze", until: "2027-01-23", note: "x" }).error,
    /90日まで/,
  );
});

test("できなかった: 理由が要り、まだのまま", () => {
  assert.match(answer({ id: "hand", kind: "could-not" }).error, /理由/);
  assert.equal(answer({ id: "hand", kind: "could-not", note: "時間が無い" }).status, "open");
});

test("答えられるのは担当者だけ・相談先に回った物は相談先だけ(相談先は分からないを選べない)", () => {
  assert.match(
    answer({ id: "ask", kind: "pick", choice: "やった", by: "@someone" }).error,
    /担当者/,
  );
  assert.match(answer({ id: "advised", kind: "pick", choice: "やった" }).error, /相談先/);
  assert.equal(answer({ id: "advised", kind: "pick", choice: "やった", by: "adv" }).status, "done");
  assert.match(
    answer({ id: "advised", kind: "unsure", by: "@adv" }).error,
    /「分からない」を選べない/,
  );
});

test("答えない項目: 無い・引退・自動で確かめる・種類の取り違え", () => {
  assert.match(answer({ id: "none", kind: "did" }).error, /無い/);
  assert.match(answer({ id: "old", kind: "did" }).error, /引退/);
  assert.match(answer({ id: "auto", kind: "did" }).error, /自動で確かめる/);
  assert.match(answer({ id: "hand", kind: "pick", choice: "x" }).error, /ask だけ/);
  assert.match(answer({ id: "ask", kind: "did" }).error, /manual だけ/);
});

test("本物の台帳に書き戻すと、書いた所だけが変わり、記録は足すだけで、台帳は壊れない", () => {
  const text = readFileSync(FILE, "utf8");
  const before = loadLedger(text);
  const real = { ...before, owners: { ...before.owners } };
  const mfa = decide(real, {
    id: "acct-mfa",
    by: before.owners.responder,
    kind: "snooze",
    until: "2026-11-24",
    note: "AWS の root がまだ: 来月",
    today,
  });
  let next = writeAnswer(text, "acct-mfa", mfa);
  const legal = decide(loadLedger(next), {
    id: "legal-terms",
    by: before.owners.responder,
    kind: "did",
    today,
  });
  next = writeAnswer(next, "legal-terms", legal);
  const after = loadLedger(next);
  assert.deepEqual(validateLedger(after), []);
  assert.deepEqual(historyAppendOnly(before, after), []);
  // 増えたのは3行だけ(acct-mfa: 2行が4行に・legal-terms: 2行が3行に)
  const lines = (t) => t.split("\n");
  assert.equal(lines(next).length, lines(text).length + 3);
  const added = lines(next).filter((l) => !lines(text).includes(l));
  assert.deepEqual(added, [
    "    status: snoozed",
    "    snoozed_until: 2026-11-24",
    `      - { on: 2026-10-24, by: "${before.owners.responder}", result: snoozed, note: "AWS の root がまだ: 来月" }`,
    `      - { on: 2026-10-24, by: "${before.owners.responder}", result: did }`,
  ]);
  assert.equal(after.items.find((i) => i.id === "acct-mfa").snoozed_until, "2026-11-24");
});

test("今はやらないから戻ったら、次に聞く日を消す", () => {
  const text = [
    "items:",
    "  - id: a",
    "    status: snoozed",
    "    snoozed_until: 2026-10-30",
    "    history:",
    "      - { on: 2026-10-20, by: x, result: snoozed }",
    "",
  ].join("\n");
  const out = writeAnswer(text, "a", {
    status: "done",
    entry: { on: today, by: "@x", result: "did" },
  });
  assert.equal(
    out,
    [
      "items:",
      "  - id: a",
      "    status: done",
      "    history:",
      "      - { on: 2026-10-20, by: x, result: snoozed }",
      '      - { on: 2026-10-24, by: "@x", result: did }',
      "",
    ].join("\n"),
  );
});
