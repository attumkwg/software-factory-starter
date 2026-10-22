// 確かめ方(checks/*.mjs)のテストの続き(Renovate・ワークフロー・ファイル・コマンド)。node --test scripts/checkup/checks-more.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { check as minutes } from "./checks/actions-minutes.mjs";
import { check as attack } from "./checks/attack-runbook.mjs";
import { check as coverage } from "./checks/coverage-total.mjs";
import { check as decisions } from "./checks/decisions.mjs";
import { check as eol, majorsAfter } from "./checks/eol.mjs";
import { check as fuzz } from "./checks/fuzz-run.mjs";
import { check as guards } from "./checks/guards.mjs";
import { check as incidents, issueNumbers } from "./checks/incident-followups.mjs";
import { check as ledgerReview } from "./checks/ledger-review.mjs";
import { check as major } from "./checks/major-backlog.mjs";
import { check as flow } from "./checks/renovate-flow.mjs";
import { check as installed } from "./checks/renovate-installed.mjs";
import { check as review } from "./checks/security-review-record.mjs";
import { err, fakeCtx, ok } from "./fake-context.mjs";

const pr = (created, state = "closed") => ({ created_at: `${created}T00:00:00Z`, state });
const search = (items) => ({ "search/issues": ok({ total_count: items.length, items }) });

test("dep-renovate: PR が一度でもあれば合格・無ければ不合格・読めなければ unknown", async () => {
  assert.equal((await installed(fakeCtx({ gh: search([pr("2026-10-20")]) }))).result, "pass");
  assert.equal((await installed(fakeCtx({ gh: search([]) }))).result, "fail");
  assert.equal((await installed(fakeCtx({}))).result, "unknown");
});

test("w-renovate: 7日より長く開いている・14日来ていない・一度も無い は不合格", async () => {
  assert.equal((await flow(fakeCtx({ gh: search([pr("2026-10-20", "open")]) }))).result, "pass");
  const stuck = await flow(fakeCtx({ gh: search([pr("2026-10-20"), pr("2026-10-14", "open")]) }));
  assert.match(stuck.note, /7日より長く開いている PR が 1件/);
  const silent = await flow(fakeCtx({ gh: search([pr("2026-10-07")]) }));
  assert.match(silent.note, /14日より長く新しい PR が来ていない/);
  assert.equal((await flow(fakeCtx({ gh: search([]) }))).result, "fail");
});

test("major-backlog: 30日より長く開いた更新があれば不合格・Renovate が動いていなければ unknown", async () => {
  const gh = (old) => ({
    "search/issues": (path) =>
      path.includes("is:open")
        ? ok({ total_count: old, items: [] })
        : ok({ total_count: 3, items: [] }),
  });
  assert.equal((await major(fakeCtx({ gh: gh(0) }))).result, "pass");
  assert.equal((await major(fakeCtx({ gh: gh(2) }))).result, "fail");
  assert.equal((await major(fakeCtx({ gh: search([]) }))).result, "unknown");
});

test("w-minutes: 公開は合格・8割を超えたら不合格・読めなければ unknown", async () => {
  const priv = { "": ok({ private: true, owner: { type: "User" } }) };
  const billing = (used) => ({
    "users/o/settings/billing/actions": ok({ total_minutes_used: used, included_minutes: 2000 }),
  });
  assert.equal((await minutes(fakeCtx({ api: { "": ok({ private: false }) } }))).result, "pass");
  assert.equal((await minutes(fakeCtx({ api: priv, gh: billing(100) }))).result, "pass");
  const over = await minutes(fakeCtx({ api: priv, gh: billing(1700) }));
  assert.equal(over.result, "fail");
  assert.match(over.note, /85%/);
  assert.equal((await minutes(fakeCtx({ api: priv }))).result, "unknown");
});

test("w-guards・w-decisions: コマンドが通れば合格・落ちれば不合格・流せなければ unknown", async () => {
  const run = (code) => ({
    "scripts/check-guards.mjs": { code },
    "scripts/decisions.mjs --strict": { code },
  });
  assert.equal((await guards(fakeCtx({ run: run(0) }))).result, "pass");
  assert.equal((await guards(fakeCtx({ run: run(1) }))).result, "fail");
  assert.equal((await decisions(fakeCtx({ run: run(1) }))).result, "fail");
  assert.equal((await decisions(fakeCtx({}))).result, "unknown");
});

test("w-ledger: 見直す日の過ぎた項目を出す", async () => {
  const ledger = { items: [{ id: "a", review_by: "2026-10-01", status: "open" }] };
  const r = await ledgerReview(fakeCtx({ ledger }));
  assert.equal(r.result, "fail");
  assert.match(r.note, /1件: a/);
  assert.equal((await ledgerReview(fakeCtx({ ledger: { items: [] } }))).result, "pass");
});

test("coverage-total: 単体だけで測っていれば不合格", async () => {
  const pkg = (s) => ({
    "apps/api/package.json": JSON.stringify({ scripts: { "test:coverage": s } }),
  });
  const unit = await coverage(fakeCtx({ files: pkg("vitest run --project unit --coverage") }));
  assert.equal(unit.result, "fail");
  assert.equal((await coverage(fakeCtx({ files: pkg("vitest run --coverage") }))).result, "pass");
  assert.equal((await coverage(fakeCtx({}))).result, "unknown");
});

test("runbook-attack: 手順書とアラームの両方が要る", async () => {
  const tf = { "infra/terraform/modules/waf/alarms.tf": 'metric_name = "BlockedRequests"' };
  const both = await attack(fakeCtx({ files: { "docs/runbooks/attack.md": "#", ...tf } }));
  assert.equal(both.result, "pass");
  const onlyAlarm = await attack(fakeCtx({ files: tf }));
  assert.equal(onlyAlarm.result, "fail");
  assert.match(onlyAlarm.note, /attack\.md/);
});

test("fuzz-first: 成功した実行があれば合格・無ければ不合格・ワークフローが無ければ不合格", async () => {
  const runs = (list) => ({ "actions/workflows/security-fuzz.yml/runs": list });
  const success = ok({ workflow_runs: [{ created_at: "2026-10-21T00:00:00Z" }] });
  assert.equal((await fuzz(fakeCtx({ api: runs(success) }))).result, "pass");
  assert.equal((await fuzz(fakeCtx({ api: runs(ok({ workflow_runs: [] })) }))).result, "fail");
  assert.equal((await fuzz(fakeCtx({ api: runs(err(404)) }))).result, "fail");
  assert.equal((await fuzz(fakeCtx({}))).result, "unknown");
});

const INCIDENT = [
  "# 2026-11-01 ログインできない",
  "## 何が起きたか",
  "#99 とは関係ない",
  "## 再発防止(どれにするかを必ず決める)",
  "| テスト | 足した | #12 |",
  "| 手順書 | 直す | https://github.com/o/r/issues/13 |",
  "## 付録",
].join("\n");

test("incident-followups: 再発防止の節の Issue だけを見て、開いていれば不合格", async () => {
  assert.deepEqual(issueNumbers("#12 と /issues/13 と # と #x"), [12, 13]);
  const files = {
    "docs/incidents/2026-11-01-login.md": INCIDENT,
    "docs/incidents/README.md": "#1",
  };
  const state = (s13) => ({
    "issues/12": ok({ state: "closed" }),
    "issues/13": ok({ state: s13 }),
  });
  assert.equal((await incidents(fakeCtx({ files, api: state("closed") }))).result, "pass");
  assert.equal((await incidents(fakeCtx({ files, api: state("open") }))).result, "fail");
  assert.equal((await incidents(fakeCtx({ files: {} }))).result, "pass");
  assert.equal((await incidents(fakeCtx({ files }))).result, "unknown");
});

test("security-review-all: 半年以内の記録があれば合格", async () => {
  const at = (d) => ({ files: { [`docs/security/reviews/${d}.md`]: "#" } });
  assert.equal((await review(fakeCtx(at("2026-06-01")))).result, "pass");
  assert.equal((await review(fakeCtx(at("2026-01-01")))).result, "fail");
  assert.equal((await review(fakeCtx({}))).result, "fail");
});

test("eol: 版を読み取り、期限が半年以内なら不合格・表に無い版は unknown", async () => {
  assert.deepEqual(majorsAfter("FROM node:24-slim AS b\nFROM node:24", "FROM node:"), [24]);
  const files = (node, pg) => ({
    "apps/api/Dockerfile": `FROM node:${node}-trixie-slim`,
    "docker-compose.yml": `    image: postgres:${pg}-alpine`,
  });
  assert.equal((await eol(fakeCtx({ files: files(24, 17) }))).result, "pass");
  const near = await eol(fakeCtx({ files: files(22, 17), today: "2026-11-01" }));
  assert.equal(near.result, "fail");
  assert.match(near.note, /node 22/);
  assert.equal((await eol(fakeCtx({ files: files(99, 17) }))).result, "unknown");
});
