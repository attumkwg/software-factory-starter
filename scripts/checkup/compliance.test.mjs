// 認証の準備の項目(area: compliance)と、その確かめ方のテスト。node --test scripts/checkup/compliance.test.mjs
// 決まりは docs/designs/0019-evidence-soa-and-cost.md の 2.・6.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check as evidenceCollected } from "./checks/evidence-collected.mjs";
import { check as policiesAdopted } from "./checks/policies-adopted.mjs";
import { check as policiesReview } from "./checks/policies-review.mjs";
import { err, fakeCtx, ok } from "./fake-context.mjs";
import { renderReadme } from "./readme.mjs";
import { headline } from "./report.mjs";
import { runCheckup } from "./runner.mjs";
import { FILE, loadLedger, selectItems, validateLedger } from "./todo.mjs";

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
const problemsOf = (over, items) => validateLedger({ ...head, ...over, items }, []).join("\n");
const ids = (sel) => Object.values(sel).flatMap((list) => list.map((i) => i.id));

test("台帳の controls・evidence・area・compliance の形を見る", () => {
  assert.equal(problemsOf({}, [item({ controls: ["A.5.1", "A.8.34"], evidence: ["drills"] })]), "");
  assert.match(problemsOf({}, [item({ controls: ["5.1"] })]), /附属書 A の番号/);
  assert.match(problemsOf({}, [item({ controls: "A.5.1" })]), /controls は一覧/);
  assert.match(problemsOf({}, [item({ evidence: ["Drills!"] })]), /証跡の名前/);
  assert.match(problemsOf({}, [item({ area: "isms" })]), /area「isms」/);
  assert.match(problemsOf({ compliance: "yes" }, [item({})]), /true か false/);
});

test("認証の準備の項目は compliance: true のときだけ毎週の点検に入り、--area compliance ではそれだけが出る", () => {
  const items = [item({ id: "plain" }), item({ id: "cert", area: "compliance" })];
  const today = "2026-10-25";
  assert.deepEqual(ids(selectItems({ ...head, items }, "setup", today)), ["plain"]);
  assert.deepEqual(ids(selectItems({ ...head, compliance: true, items }, "setup", today)), [
    "plain",
    "cert",
  ]);
  assert.deepEqual(ids(selectItems({ ...head, items }, "setup", today, { area: "compliance" })), [
    "cert",
  ]);
});

test("台帳: 認証の準備の項目がそろい、どの項目にも管理策の番号がある(SoA の点検の欄の元)", () => {
  const cert = ledger.items.filter((i) => i.area === "compliance").map((i) => i.id);
  for (const id of [
    "policies-adopt",
    "evidence-monthly",
    "training",
    "vendor-review",
    "internal-audit",
    "management-review",
    "policy-review",
  ])
    assert.ok(cert.includes(id), id);
  for (const i of ledger.items) assert.ok((i.controls ?? []).length > 0, `${i.id} に controls`);
  assert.equal(ledger.compliance, false, "キットの既定は毎週の点検に出さない(設計書 0019 の U-2)");
});

test("--area compliance の結果は /compliance-check へ案内する", async () => {
  const items = [item({ id: "cert", area: "compliance" })];
  const run = await runCheckup({
    ledger: { ...head, items },
    checks: new Map(),
    ctx: fakeCtx({}),
    today: "2026-10-25",
    area: "compliance",
  });
  assert.match(headline(run)[0], /\/compliance-check/);
});

test("点検の README に、認証の準備の印と今の compliance が出る", () => {
  const text = renderReadme({ ...head, items: [item({ area: "compliance" })] });
  assert.match(text, /人・認証/);
  assert.match(text, /compliance: false/);
});

test("evidence-collected: 35日のうちの成功で合格・無ければ不合格", async () => {
  let asked = "";
  const ctx = fakeCtx({
    today: "2026-11-02",
    api: {
      "actions/workflows/evidence.yml/runs": (p) => {
        asked = p;
        return ok({ workflow_runs: [{ created_at: "2026-11-01T00:10:00Z" }] });
      },
    },
  });
  assert.equal((await evidenceCollected(ctx)).result, "pass");
  assert.match(asked, /created=>2026-09-28/);
  const none = fakeCtx({
    api: { "actions/workflows/evidence.yml/runs": ok({ workflow_runs: [] }) },
  });
  assert.equal((await evidenceCollected(none)).result, "fail");
  const missing = fakeCtx({ api: { "actions/workflows/evidence.yml/runs": err(404) } });
  assert.equal((await evidenceCollected(missing)).result, "fail");
});

const policy = (meta, body = "本文") =>
  `---\n${Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n${body}\n`;
const META = { title: "t", version: '"1"', owner: "o", controls: "[A.5.1]" };

test("policies-adopted: 制定日があり「要記入」が無ければ合格", async () => {
  const done = policy({ ...META, established: "2026-10-01", next_review: "2027-10-01" });
  const draft = policy({ ...META, established: "null" });
  const left = policy({ ...META, established: "2026-10-01" }, "会社名は【要記入: 会社名】");
  const dir = "docs/compliance/policies";
  const run = (files) => policiesAdopted(fakeCtx({ files }));
  assert.equal(
    (await run({ [`${dir}/a.md`]: done, [`${dir}/README.md`]: "【要記入】" })).result,
    "pass",
  );
  assert.match((await run({ [`${dir}/a.md`]: done, [`${dir}/b.md`]: draft })).note, /b\.md/);
  assert.equal((await run({ [`${dir}/c.md`]: left })).result, "fail");
  assert.equal((await run({})).result, "fail");
});

test("policies-review: 見直しの日が来た規程があれば不合格", async () => {
  const dir = "docs/compliance/policies";
  const due = policy({ ...META, established: "2025-10-01", next_review: "2026-10-01" });
  const later = policy({ ...META, established: "2026-10-01", next_review: "2027-10-01" });
  const run = (files) => policiesReview(fakeCtx({ files, today: "2026-10-25" }));
  assert.equal((await run({ [`${dir}/a.md`]: later })).result, "pass");
  assert.match((await run({ [`${dir}/a.md`]: later, [`${dir}/b.md`]: due })).note, /b\.md/);
});
