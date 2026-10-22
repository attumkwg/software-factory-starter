// 確かめ方(checks/*.mjs)のテスト。GitHub とファイルは偽物の ctx で差し替える。node --test scripts/checkup/checks.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { check as envs } from "./checks/github-environments.mjs";
import { check as plan } from "./checks/github-plan.mjs";
import { check as protection } from "./checks/github-protection.mjs";
import { check as both } from "./checks/protection-and-envs.mjs";
import { check as secrets } from "./checks/secret-scanning.mjs";
import { check as features } from "./checks/security-features.mjs";
import { check as vulns } from "./checks/vulns.mjs";
import { err, fakeCtx, ok } from "./fake-context.mjs";
import { httpStatus } from "./gh.mjs";

const RULES_OK = [
  { type: "pull_request", parameters: {} },
  {
    type: "required_status_checks",
    parameters: {
      required_status_checks: [{ context: "CI" }],
      strict_required_status_checks_policy: true,
    },
  },
];
const UPGRADE = err(403, "gh: Upgrade to GitHub Pro or make this repository public (HTTP 403)");

test("gh のエラーの文から HTTP の番号を取る", () => {
  assert.equal(httpStatus("gh: Branch not protected (HTTP 404)"), 404);
  assert.equal(httpStatus("exec: gh not found"), 0);
});

test("gh-plan: 公開なら合格・非公開で 403(Upgrade)なら不合格・読めなければ unknown", async () => {
  assert.equal((await plan(fakeCtx({ api: { "": ok({ visibility: "public" }) } }))).result, "pass");
  const priv = { "": ok({ visibility: "private", private: true }) };
  const fail = await plan(fakeCtx({ api: { ...priv, "branches/main/protection": UPGRADE } }));
  assert.equal(fail.result, "fail");
  const nf = await plan(fakeCtx({ api: { ...priv, "branches/main/protection": err(404) } }));
  assert.equal(nf.result, "pass");
  assert.equal((await plan(fakeCtx({}))).result, "unknown");
});

test("gh-protection: ルールセットで足りれば合格・足りない物を出す・旧来の保護も見る", async () => {
  const pass = await protection(fakeCtx({ api: { "rules/branches/main": ok(RULES_OK) } }));
  assert.equal(pass.result, "pass");
  const lacking = await protection(
    fakeCtx({
      api: {
        "rules/branches/main": ok([{ type: "pull_request" }]),
        "branches/main/protection": err(404),
      },
    }),
  );
  assert.equal(lacking.result, "fail");
  assert.match(lacking.note, /CI 必須・最新に追いついてから/);
  const classic = await protection(
    fakeCtx({
      api: {
        "rules/branches/main": ok([]),
        "branches/main/protection": ok({
          required_pull_request_reviews: {},
          required_status_checks: { strict: true, contexts: ["CI"] },
        }),
      },
    }),
  );
  assert.equal(classic.result, "pass");
  const plan403 = await protection(
    fakeCtx({ api: { "rules/branches/main": ok([]), "branches/main/protection": UPGRADE } }),
  );
  assert.equal(plan403.result, "fail");
  const noPerm = await protection(
    fakeCtx({ api: { "rules/branches/main": ok([]), "branches/main/protection": err(403, "x") } }),
  );
  assert.equal(noPerm.result, "unknown");
});

const env = (name, custom = true) => ({
  name,
  deployment_branch_policy: custom ? { custom_branch_policies: true } : null,
});
const mainOnly = ok({ branch_policies: [{ name: "main", type: "branch" }] });

test("gh-envs: stg・prod・claude が main だけなら合格・無い/どこからでも/main 以外も は不合格", async () => {
  const api = {
    environments: ok({ environments: [env("stg"), env("prod"), env("claude")] }),
    "environments/*": mainOnly,
  };
  assert.equal((await envs(fakeCtx({ api }))).result, "pass");
  const bad = await envs(
    fakeCtx({
      api: {
        environments: ok({ environments: [env("stg", false), env("prod")] }),
        "environments/*": ok({ branch_policies: [{ name: "main" }, { name: "dev" }] }),
      },
    }),
  );
  assert.equal(bad.result, "fail");
  assert.match(bad.note, /stg がどのブランチからでも使える/);
  assert.match(bad.note, /prod が main 以外からも使える/);
  assert.match(bad.note, /claude が無い/);
});

test("w-protection: どちらかが落ちたら不合格・読めなければ unknown", async () => {
  const api = {
    "rules/branches/main": ok(RULES_OK),
    environments: ok({ environments: [env("stg")] }),
    "environments/*": mainOnly,
  };
  assert.equal((await both(fakeCtx({ api }))).result, "fail");
  assert.equal(
    (await both(fakeCtx({ api: { "rules/branches/main": ok(RULES_OK) } }))).result,
    "unknown",
  );
});

test("dep-alerts: 両方オンで合格・オフを出す・管理者でなければ unknown", async () => {
  const on = { "": ok({ security_and_analysis: { secret_scanning: { status: "enabled" } } }) };
  assert.equal(
    (await features(fakeCtx({ api: { ...on, "vulnerability-alerts": ok(null) } }))).result,
    "pass",
  );
  const off = await features(fakeCtx({ api: { ...on, "vulnerability-alerts": err(404) } }));
  assert.equal(off.result, "fail");
  assert.match(off.note, /Dependabot の通知/);
  const notAdmin = { "": ok({}), "vulnerability-alerts": ok(null) };
  assert.equal((await features(fakeCtx({ api: notAdmin }))).result, "unknown");
});

test("w-secrets: 0件で合格・見つけ物は件数だけ出す(中身は出さない)・オフは不合格", async () => {
  const path = "secret-scanning/alerts";
  assert.equal((await secrets(fakeCtx({ api: { [path]: ok([]) } }))).result, "pass");
  const found = await secrets(
    fakeCtx({ api: { [path]: ok([{ secret: "AKIA-SECRET-VALUE", secret_type: "aws" }]) } }),
  );
  assert.equal(found.result, "fail");
  assert.match(found.note, /1件/);
  assert.doesNotMatch(found.note, /AKIA|aws/);
  assert.equal((await secrets(fakeCtx({ api: { [path]: err(404) } }))).result, "fail");
  assert.equal((await secrets(fakeCtx({}))).result, "unknown");
});

const RECORD = [
  "| 日付 | ID | パッケージ | 結果 | 理由 | 見直す日 |",
  "|---|---|---|---|---|---|",
  "| 2026-10-22 | GHSA-aaaa-bbbb-cccc | x | 入っているが届かない | 開発用 | 2027-01-22 |",
].join("\n");
const alert = (number, ghsa) => ({ number, security_advisory: { ghsa_id: ghsa, cve_id: null } });
const vulnCtx = (alerts, drafts = ok([]), runs = ok({ workflow_runs: [] })) =>
  fakeCtx({
    api: {
      "dependabot/alerts": alerts,
      "security-advisories": drafts,
      "actions/workflows/vuln-scan.yml/runs": runs,
    },
    files: { "docs/security/vulns.md": RECORD },
  });

test("w-vuln: 「精査していない」「届く・まだ直していない」が両方0件のときだけ緑", async () => {
  const recorded = await vulns(vulnCtx(ok([alert(1, "GHSA-aaaa-bbbb-cccc")])));
  assert.equal(recorded.result, "pass");
  const untriaged = await vulns(vulnCtx(ok([alert(2, "GHSA-zzzz-yyyy-xxxx")])));
  assert.equal(untriaged.result, "fail");
  assert.match(untriaged.note, /精査していない 1件/);
  const drafts = ok([{ summary: "x", description: "GHSA-zzzz-yyyy-xxxx" }]);
  const privately = await vulns(vulnCtx(ok([alert(2, "GHSA-zzzz-yyyy-xxxx")]), drafts));
  assert.equal(privately.result, "fail");
  assert.match(privately.note, /届く・まだ直していない 1件/);
});

test("w-vuln: 勧告の ID やパッケージの名前を出さない(公開のリポジトリ)", async () => {
  const r = await vulns(vulnCtx(ok([alert(2, "GHSA-zzzz-yyyy-xxxx")])));
  assert.doesNotMatch(r.note, /GHSA|zzzz/i);
});

test("w-vuln: 通知を読めなければ unknown・下書きを読めず未精査があれば unknown・見回りが赤なら不合格", async () => {
  assert.equal((await vulns(vulnCtx(err(403)))).result, "unknown");
  const noDrafts = await vulns(vulnCtx(ok([alert(2, "GHSA-zzzz-yyyy-xxxx")]), err(403)));
  assert.equal(noDrafts.result, "unknown");
  const red = ok({ workflow_runs: [{ conclusion: "failure" }] });
  assert.equal((await vulns(vulnCtx(ok([]), ok([]), red))).result, "fail");
});
