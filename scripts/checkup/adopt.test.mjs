// 台帳を自分の物にする(pnpm checkup:adopt)のテスト。本物の台帳で流し、書き方と「足すだけ」が崩れないかを見る。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ADOPTED_NOTE, adoptLedger } from "./adopt.mjs";
import { loadChecks } from "./runner.mjs";
import { FILE, historyAppendOnly, loadLedger, validateLedger } from "./todo.mjs";

const SAMPLE = `# 先頭のコメント
started_on: 2026-10-17 # 使い始めた日
refreshed_on: 2026-10-20
owners:
  responder: "@kit-owner"
  advisor: "@kit-owner"
items:
  - id: a
    status: done
    history:
      - { on: 2026-10-18, by: "@kit-owner", result: answered, choice: はい }
  - id: b
    status: snoozed
    snoozed_until: 2026-12-01
    history: []
  - id: c
    status: retired
    history:
      - { on: 2026-10-19, by: checkup-refresh, result: retired, note: 要らなくなった }
`;

test("使い始めた日・担当者を変え、引退していない項目を「まだ」に戻して adopted を1行足す", () => {
  const { text, reset } = adoptLedger(SAMPLE, { by: "alice", today: "2026-11-02" });
  const before = loadLedger(SAMPLE);
  const after = loadLedger(text);
  assert.equal(reset, 2);
  assert.equal(String(after.started_on), "2026-11-02");
  assert.deepEqual(after.owners, { responder: "@alice", advisor: "@alice" });
  assert.equal(after.refreshed_on, undefined);
  const [a, b, c] = after.items;
  assert.equal(a.status, "open");
  assert.equal(b.status, "open");
  assert.equal(b.snoozed_until, undefined);
  assert.deepEqual(a.history.at(-1), {
    on: "2026-11-02",
    by: "@alice",
    result: "adopted",
    note: ADOPTED_NOTE,
  });
  assert.deepEqual(c, before.items[2]);
  assert.deepEqual(historyAppendOnly(before, after), []);
  assert.match(text, /^# 先頭のコメント/);
  assert.match(text, /# 使い始めた日/);
});

test("相談先を別の人にできる", () => {
  const after = loadLedger(
    adoptLedger(SAMPLE, { by: "@alice", advisor: "bob", today: "2026-11-02" }).text,
  );
  assert.deepEqual(after.owners, { responder: "@alice", advisor: "@bob" });
});

test("本物の台帳に流しても、書き方の決まりを通る", async () => {
  const text = readFileSync(FILE, "utf8");
  const names = [...(await loadChecks()).keys()];
  const after = loadLedger(adoptLedger(text, { by: "@alice", today: "2026-11-02" }).text);
  assert.deepEqual(validateLedger(after, names), []);
  assert.deepEqual(historyAppendOnly(loadLedger(text), after), []);
  assert.ok(after.items.every((i) => i.status === "open" || i.status === "retired"));
});
