// 点検の流れ(runner.mjs)・結果の文(report.mjs)・1枚(readme.mjs)のテスト。node --test scripts/checkup/run.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fakeCtx } from "./fake-context.mjs";
import { README, renderReadme } from "./readme.mjs";
import { headline, renderReport } from "./report.mjs";
import { runCheckup, toJson, urgentOf } from "./runner.mjs";
import { FILE, loadLedger } from "./todo.mjs";

const item = (over) => ({
  title: `題 ${over.id}`,
  why: "なぜ",
  if_ignored: "放っておくと",
  who: "system",
  phase: "setup",
  every: "weekly",
  verify: "auto",
  severity: "normal",
  status: "open",
  history: [],
  source: "s",
  review_by: "2027-04-20",
  ...over,
});
const ledgerOf = (...items) => ({
  started_on: "2026-10-17",
  owners: { responder: "@a", advisor: "@b" },
  items,
});
const result =
  (r, note = r) =>
  async () => ({ result: r, note });
const run = (ledger, checks, today = "2026-10-22") =>
  runCheckup({ ledger, checks: new Map(Object.entries(checks)), ctx: fakeCtx({ ledger }), today });

test("何も起きていない週も「答えることはありません」「急ぎ: なし」と出す", async () => {
  const r = await run(ledgerOf(item({ id: "a", check: "ok" })), { ok: result("pass") });
  const lines = headline(r);
  assert.equal(lines[0], "今週あなたが答えること: 答えることはありません");
  assert.equal(lines[1], "急ぎ: なし");
  assert.equal(lines[2], "自動で確かめて問題なし: 1件");
  assert.ok(lines[3].includes("立ち上げ(使い始めて 6日目)。次の段階「1か月」は 2026-11-16 から"));
});

test("問いの数と時間を一番上に出す(ask 3分・manual 10分)", async () => {
  const ledger = ledgerOf(
    item({ id: "q", verify: "ask", question: { text: "問い?" } }),
    item({ id: "m", verify: "manual", steps: ["1", "2"] }),
  );
  const text = renderReport(await run(ledger, {}));
  assert.ok(text.split("\n")[2].includes("今週あなたが答えること: 2問(約13分)"));
  assert.match(text, /問い: 問い?/);
  assert.match(text, /手順は 2つ/);
});

test("急ぎは severity: high の fail だけ。done から fail に戻ったら「守りが外れた」", async () => {
  const ledger = ledgerOf(
    item({ id: "high", severity: "high", check: "bad", status: "done" }),
    item({ id: "normal", check: "bad" }),
    item({ id: "high-unknown", severity: "high", check: "unknown" }),
  );
  const r = await run(ledger, { bad: result("fail", "落ちた"), unknown: result("unknown") });
  assert.deepEqual(
    urgentOf(r).map((x) => x.item.id),
    ["high"],
  );
  assert.equal(r.results[0].regressed, true);
  const text = renderReport(r);
  assert.match(text, /急ぎ: 1件 — 題 high/);
  assert.match(text, /【守りが外れた】題 high/);
  assert.ok(text.includes("## 🟡 落ちた(急がない)\n\n- 題 normal"));
  assert.match(text, /## ❔ 確かめられなかった/);
});

test("確かめが投げても全体は止めず unknown・確かめ方が無ければ unknown・同じ確かめは1回だけ", async () => {
  let calls = 0;
  const ledger = ledgerOf(
    item({ id: "a", check: "boom" }),
    item({ id: "b", check: "missing" }),
    item({ id: "c", check: "count" }),
    item({ id: "d", check: "count" }),
  );
  const r = await run(ledger, {
    boom: async () => {
      throw new Error("壊れた\n2行目");
    },
    count: async () => {
      calls += 1;
      return { result: "pass", note: "ok" };
    },
  });
  assert.deepEqual(
    r.results.map((x) => [x.item.id, x.result]),
    [
      ["a", "unknown"],
      ["b", "unknown"],
      ["c", "pass"],
      ["d", "pass"],
    ],
  );
  assert.match(r.results[0].note, /壊れた/);
  assert.doesNotMatch(r.results[0].note, /2行目/);
  assert.equal(calls, 1);
});

test("段階が進むと、前の段階の残りと新しい段階の項目が両方出る", async () => {
  const ledger = ledgerOf(
    item({ id: "setup-q", verify: "ask", question: { text: "?" } }),
    item({ id: "1m-q", phase: "1m", verify: "ask", question: { text: "?" } }),
    item({ id: "3m-q", phase: "3m", verify: "ask", question: { text: "?" } }),
  );
  const ids = async (today) => (await run(ledger, {}, today)).ask.map((i) => i.id);
  assert.deepEqual(await ids("2026-11-15"), ["setup-q"]);
  assert.deepEqual(await ids("2026-11-16"), ["setup-q", "1m-q"]);
});

test("JSON の形(知らせが読む)", async () => {
  const ledger = ledgerOf(item({ id: "a", check: "ok", severity: "high" }));
  const json = toJson(await run(ledger, { ok: result("pass", "よし") }));
  assert.deepEqual(json.results, [
    { id: "a", severity: "high", result: "pass", note: "よし", regressed: false },
  ]);
  assert.deepEqual(json.next, { phase: "1m", on: "2026-11-16" });
  assert.equal(json.phase, "setup");
});

test("1枚(docs/checkup/README.md)は台帳から作った物と同じ(ずれたら pnpm checkup --write-readme)", () => {
  const ledger = loadLedger(readFileSync(FILE, "utf8"));
  const placed = readFileSync(README, "utf8").replaceAll("\r\n", "\n");
  assert.equal(placed, renderReadme(ledger));
});

test("1枚に全部の項目と段階が載り、表を壊す「|」は置き換える", () => {
  const text = renderReadme(
    ledgerOf(item({ id: "a", title: "A | B", phase: "1y", advisory: true })),
  );
  assert.ok(text.includes("| 1年 | 2027-10-17 から(365日〜) | 1件 |"));
  assert.match(text, /A \/ B `a`/);
  assert.match(text, /仕組み・推奨/);
});
