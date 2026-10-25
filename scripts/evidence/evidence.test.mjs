// 証跡の集め方のテスト(GitHub と AWS は偽物)。node --test scripts/evidence/evidence.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { err, fakeCtx, ok } from "../checkup/fake-context.mjs";
import { collectAll, logLine, makeBundle, mask, sha256, sizeOf } from "./lib.mjs";
import { EVIDENCE_NAMES, pick } from "./sources.mjs";
import { AWS_SOURCES, parseCredentialReport, securityScore } from "./sources-aws.mjs";
import { GITHUB_SOURCES } from "./sources-github.mjs";

const byName = (list, name) => list.find((s) => s.name === name).collect;
/** 偽物の aws: 「引数を空白でつないだ頭」→ 応答 */
const fakeAws = (table) => (args) => {
  const line = args.join(" ");
  const key = Object.keys(table)
    .filter((k) => line.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key === undefined ? { ok: false, message: "aws が入っていない" } : table[key];
};

test("証跡の名前は重ならず、英小文字とハイフンだけ(台帳と SoA が指す)", () => {
  assert.equal(new Set(EVIDENCE_NAMES).size, EVIDENCE_NAMES.length);
  for (const n of EVIDENCE_NAMES) assert.match(n, /^[a-z0-9-]+$/);
  assert.deepEqual(
    pick("repo").map((s) => s.name),
    ["checkup-ledger", "compliance-docs"],
  );
  assert.ok(pick("aws").every((s) => s.name.startsWith("aws-")));
  assert.ok(
    pick("github").some((s) => s.name === "drills"),
    "drills は GitHub の組",
  );
});

test("束: 1件1ファイルと、SHA-256 つきの目録", () => {
  const files = makeBundle({
    kind: "evidence",
    month: "2026-10",
    collectedAt: "2026-10-01T00:00:00Z",
    repo: "o/r",
    commit: "abc",
    entries: [
      { name: "a", about: "A", ok: true, data: [1, 2] },
      { name: "b", about: "B", ok: false, reason: "読めなかった" },
    ],
  });
  const manifest = JSON.parse(files.get("manifest.json"));
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.files[0].sha256, sha256(files.get("a.json")));
  assert.equal(manifest.files[0].size, 2);
  assert.equal(manifest.files[1].reason, "読めなかった");
  assert.equal(JSON.parse(files.get("b.json")).data, undefined);
});

test("ログの行は名前と件数だけ。アカウントの番号と ARN は伏せる", () => {
  const line = logLine({ name: "aws-iam-users", ok: true, data: [{ user: "taro" }] });
  assert.equal(line, "✅ aws-iam-users(1件)");
  assert.doesNotMatch(line, /taro/);
  const masked = mask(
    "User: arn:aws:sts::123456789012:assumed-role/x/y is not authorized in 123456789012",
  );
  assert.doesNotMatch(masked, /123456789012|arn:aws/);
  assert.equal(sizeOf({ a: 1, b: 2 }), 2);
});

test("1つの集め先が投げても、ほかは集める(理由は伏せてから残す)", async () => {
  const boom = () => Promise.reject(new Error("arn:aws:iam::123456789012:x"));
  const entries = await collectAll(
    [
      { name: "boom", about: "", collect: boom },
      { name: "fine", about: "", collect: async () => ok([1]) },
      { name: "no", about: "", collect: async () => ({ ok: false, message: "権限が無い" }) },
    ],
    {},
  );
  assert.deepEqual(
    entries.map((e) => [e.name, e.ok]),
    [
      ["boom", false],
      ["fine", true],
      ["no", false],
    ],
  );
  assert.equal(entries[0].reason, "<ARN>");
});

const GITHUB_API = {
  rulesets: ok([{ id: 1, name: "main" }]),
  "rulesets/1": ok({
    name: "main",
    target: "branch",
    enforcement: "active",
    rules: [],
    node_id: "x",
  }),
  "rules/branches/main": ok([{ type: "pull_request" }]),
  environments: ok({
    environments: [
      {
        name: "prod",
        deployment_branch_policy: { custom_branch_policies: true },
        protection_rules: [
          {
            type: "required_reviewers",
            reviewers: [{ type: "User", reviewer: { login: "a", email: "x" } }],
          },
        ],
      },
    ],
  }),
  "environments/prod/deployment-branch-policies": ok({ branch_policies: [{ name: "main" }] }),
  collaborators: ok([
    { login: "a", type: "User", role_name: "admin", email: "secret@example.com" },
  ]),
  invitations: err(403),
};

test("github-ruleset・environments・collaborators を読み、要る所だけ残す", async () => {
  const ctx = fakeCtx({ api: GITHUB_API });
  const rules = await byName(GITHUB_SOURCES, "github-ruleset")(ctx);
  assert.equal(rules.data.rulesets[0].enforcement, "active");
  assert.equal(rules.data.rulesets[0].node_id, undefined);
  const envs = await byName(GITHUB_SOURCES, "github-environments")(ctx);
  assert.deepEqual(envs.data[0].allowed_branches, ["main"]);
  assert.deepEqual(envs.data[0].protection_rules[0].reviewers, [{ type: "User", name: "a" }]);
  const people = await byName(GITHUB_SOURCES, "github-collaborators")(ctx);
  assert.deepEqual(people.data.collaborators, [{ login: "a", type: "User", role: "admin" }]);
  assert.equal(people.data.pending_invitations, null);
  assert.doesNotMatch(JSON.stringify(people), /secret@/);
  assert.equal((await byName(GITHUB_SOURCES, "github-ruleset")(fakeCtx({}))).ok, false);
});

test("github-security は通知の件数だけ・drills は前の月からの実行", async () => {
  let asked = "";
  const runs = (p) => {
    if (p.includes("restore-drill")) asked = p;
    return ok({ workflow_runs: [{ event: "schedule", conclusion: "success", created_at: "x" }] });
  };
  const repo = { visibility: "public", security_and_analysis: { secret_scanning: {} } };
  const ctx = {
    ...fakeCtx({
      api: {
        "": ok(repo),
        "dependabot/alerts": ok([
          { security_advisory: { severity: "high", summary: "中身" } },
          { security_advisory: { severity: "high" } },
        ]),
        "secret-scanning/alerts": ok([]),
        "code-scanning/alerts": err(404),
        "actions/workflows/*": runs,
      },
    }),
    since: "2026-09-01",
  };
  const sec = await byName(GITHUB_SOURCES, "github-security")(ctx);
  assert.deepEqual(sec.data.dependabot_alerts, { open: 2, by_severity: { high: 2 } });
  assert.equal(sec.data.code_scanning_alerts, null);
  assert.doesNotMatch(JSON.stringify(sec), /中身/);
  const drills = await byName(GITHUB_SOURCES, "drills")(ctx);
  assert.equal(drills.data["restore-drill.yml"][0].conclusion, "success");
  assert.match(asked, /created=>=2026-09-01/);
});

test("資格情報のレポートは、決めた列だけ(ARN や鍵そのものは残さない)", () => {
  const csv = [
    "user,arn,user_creation_time,password_enabled,password_last_used,mfa_active,access_key_1_active",
    "<root_account>,arn:aws:iam::123456789012:root,2026-01-01,not_supported,2026-10-01,true,false",
    "taro,arn:aws:iam::123456789012:user/taro,2026-02-01,true,2026-10-20,false,true",
  ].join("\n");
  const rows = parseCredentialReport(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].mfa_active, "false");
  assert.equal(rows[1].access_key_2_active, null);
  assert.doesNotMatch(JSON.stringify(rows), /arn:aws|123456789012/);
});

test("aws-iam-users はレポートができるまで待ってから読む", async () => {
  let calls = 0;
  const csv = "user,mfa_active\ntaro,true\n";
  const ctx = {
    aws: (args) => {
      if (args[1] === "generate-credential-report")
        return ok({ State: ++calls < 2 ? "STARTED" : "COMPLETE" });
      return ok({ Content: Buffer.from(csv).toString("base64"), GeneratedTime: "t" });
    },
    sleep: async () => {},
  };
  const res = await byName(AWS_SOURCES, "aws-iam-users")(ctx);
  assert.equal(calls, 2);
  assert.equal(res.data.users[0].mfa_active, "true");
});

test("Security Hub の点数: 管理策ごとに全部が PASSED なら合格", () => {
  const score = securityScore([
    { c: "S3.1", s: "PASSED" },
    { c: "S3.1", s: "FAILED", v: "HIGH" },
    { c: "IAM.1", s: "PASSED" },
    { c: "EC2.1", s: "PASSED" },
    { c: "EC2.1", s: "PASSED" },
    { c: "X", s: "NOT_AVAILABLE" },
  ]);
  assert.deepEqual(score, {
    score_percent: 67,
    controls: 3,
    failed_controls: ["S3.1"],
    failed_by_severity: { HIGH: 1 },
  });
  assert.equal(securityScore([]).score_percent, null);
});

test("AWS の集め先: 読めなければ ok: false・読めれば要る所だけ", async () => {
  const ctx = {
    aws: fakeAws({
      "guardduty list-detectors": ok({ DetectorIds: ["d1"] }),
      "guardduty get-detector": ok({
        Status: "ENABLED",
        Features: [{ Name: "S3_DATA_EVENTS", Status: "ENABLED" }],
      }),
      "backup list-backup-vaults": ok({
        BackupVaultList: [{ BackupVaultName: "v", Locked: true, BackupVaultArn: "arn:x" }],
      }),
      "cloudtrail describe-trails": ok({ trailList: [{ Name: "t", IsMultiRegionTrail: true }] }),
      "cloudtrail get-trail-status": ok({ IsLogging: true }),
    }),
  };
  assert.equal((await byName(AWS_SOURCES, "aws-guardduty")(ctx)).data[0].status, "ENABLED");
  const vaults = await byName(AWS_SOURCES, "aws-backup")(ctx);
  assert.doesNotMatch(JSON.stringify(vaults), /arn:x/);
  assert.equal(vaults.data[0].locked, true);
  assert.equal((await byName(AWS_SOURCES, "aws-cloudtrail")(ctx)).data[0].logging, true);
  assert.equal((await byName(AWS_SOURCES, "aws-iam-summary")(ctx)).ok, false);
});

test("CLI: --list は名前を出し、--out が無ければ 1、--only repo でフォルダに書く", () => {
  const cli = join("scripts", "evidence", "collect.mjs");
  assert.match(execFileSync("node", [cli, "--list"], { encoding: "utf8" }), /github-ruleset/);
  assert.equal(spawnSync("node", [cli], { encoding: "utf8" }).status, 1);
  const out = mkdtempSync(join(tmpdir(), "evidence-"));
  const log = execFileSync("node", [cli, "--out", out, "--only", "repo"], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REPOSITORY: "o/r" },
  });
  assert.match(log, /2件を集め、0件は読めなかった/);
  assert.deepEqual(readdirSync(out).sort(), [
    "checkup-ledger.json",
    "compliance-docs.json",
    "manifest.json",
  ]);
  const docs = JSON.parse(readFileSync(join(out, "compliance-docs.json"), "utf8"));
  assert.equal(docs.data.policies.length, 6);
});
