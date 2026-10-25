// node --test scripts/vendors.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionsIn,
  checkLedger,
  checkUsage,
  dataClassesFrom,
  matches,
  packagesIn,
  terraformIn,
  usageByVendor,
} from "./vendors-lib.mjs";
import { renderVendors } from "./vendors-render.mjs";

const dataClasses = ["public", "internal", "personal", "sensitive"];
const base = {
  status: "active",
  what: "試し",
  country: "日本",
  checked_on: "2026-10-25",
  contract: { dpa: "約款に含む", link: "https://example.com/dpa" },
  deletion: { when_we_leave: "消える", when_tenant_leaves: "消す" },
};
const aws = {
  ...base,
  id: "aws",
  name: "AWS",
  relation: "委託",
  data: ["internal", "personal"],
  match: {
    packages: ["@aws-sdk/*"],
    actions: ["aws-actions/*"],
    terraform_sources: ["hashicorp/aws"],
  },
  services: [
    { name: "S3", terraform: ["aws_s3_*"], data: ["internal"] },
    { name: "ALB", terraform: ["aws_lb", "aws_lb_*"], data: ["personal"] },
  ],
};
const github = {
  ...base,
  id: "github",
  name: "GitHub",
  relation: "委託",
  data: ["internal"],
  match: { actions: ["actions/*"] },
};
const random = {
  ...base,
  id: "hashicorp",
  name: "HashiCorp",
  relation: "渡さない",
  data: [],
  contract: { dpa: "不要", link: "https://example.com" },
  match: { terraform_sources: ["hashicorp/random"] },
};
const ledger = { vendors: [aws, github, random], service_packages: ["@sentry/*", "stripe"] };

test("* は何文字でも", () => {
  assert.equal(matches("@aws-sdk/*", "@aws-sdk/client-s3"), true);
  assert.equal(matches("aws_lb_*", "aws_lb"), false);
  assert.equal(matches("aws_lb", "aws_lb"), true);
  assert.equal(matches("aws_lb", "aws_lb_listener"), false);
  assert.equal(matches("a*b*c", "a-b-c"), true);
  assert.equal(matches("a*b*c", "a-c-b"), false);
  assert.equal(matches("ab*ba", "aba"), false);
});

test("区分は classification.ts から読む", () => {
  const ts =
    'export const DATA_CLASSES = ["public", "internal", "personal", "sensitive"] as const;';
  assert.deepEqual(dataClassesFrom(ts), dataClasses);
  assert.deepEqual(dataClassesFrom("const x = 1;"), []);
});

test("書き方の正しい台帳は問題なし", () => {
  assert.deepEqual(checkLedger(ledger, { dataClasses }), []);
});

test("台帳の書き方の誤り", () => {
  const bad = (v) => checkLedger({ vendors: [{ ...aws, ...v }] }, { dataClasses });
  assert.match(bad({ relation: "外注" }).join(), /relation は/);
  assert.match(bad({ data: ["secret"] }).join(), /区分.*に無い/);
  assert.match(bad({ contract: { dpa: "たぶん", link: "x" } }).join(), /contract.dpa/);
  assert.match(bad({ contract: { dpa: "不要", link: "x" } }).join(), /委託なのに/);
  assert.deepEqual(bad({ contract: { dpa: "結んだ(2026-10-01)", link: "x" } }), []);
  assert.match(bad({ checked_on: "去年" }).join(), /checked_on/);
  assert.match(bad({ deletion: { when_we_leave: "消える" } }).join(), /when_tenant_leaves/);
  assert.match(bad({ status: "ended" }).join(), /ended_on/);
  assert.match(
    bad({ services: [{ name: "Aurora", data: ["sensitive"] }] }).join(),
    /Aurora.*会社の data に無い/,
  );
  assert.match(checkLedger({ vendors: [aws, aws] }, { dataClasses }).join(), /重なっている/);
  assert.deepEqual(checkLedger({ vendors: [] }, { dataClasses }), ["vendors が空"]);
});

test("AI の会社と「渡さない」の会社に personal・sensitive は書けない(AI-6)", () => {
  const ai = { ...github, id: "anthropic", ai: true, data: ["internal", "personal"] };
  assert.match(
    checkLedger({ vendors: [ai] }, { dataClasses }).join(),
    /AI の会社に personal を渡さない/,
  );
  const tool = { ...random, data: ["sensitive"] };
  assert.match(checkLedger({ vendors: [tool] }, { dataClasses }).join(), /渡さない」なのに/);
});

test("package.json の依存・uses:・Terraform を集める", () => {
  const pkgs = packagesIn([
    {
      path: "a/package.json",
      json: { dependencies: { stripe: "1" }, devDependencies: { vitest: "1" } },
    },
  ]);
  assert.deepEqual(
    pkgs.map((p) => p.name),
    ["stripe", "vitest"],
  );

  const yml = [
    "steps:",
    "  - uses: actions/checkout@abc # v7",
    "  - uses: ./.github/actions/local",
    '    uses: "aws-actions/configure-aws-credentials@def"',
    "  - uses: github/codeql-action/init@123",
    "  - uses: docker://alpine:3@sha256:1",
  ].join("\n");
  assert.deepEqual(
    actionsIn([{ path: "w.yml", text: yml }]).map((a) => a.name),
    [
      "actions/checkout",
      "aws-actions/configure-aws-credentials",
      "github/codeql-action",
      "docker://alpine:3",
    ],
  );

  const tf = [
    'resource "aws_s3_bucket" "x" {',
    '  source_arn = "arn"',
    "}",
    'data "aws_lb" "y" {}',
    'module "m" {',
    '  source = "../../modules/network"',
    "}",
    '  aws = { source  = "hashicorp/aws" }',
    'resource "random_password" "p" {}',
  ].join("\n");
  const found = terraformIn([{ path: "main.tf", text: tf }]);
  assert.deepEqual(
    found.types.map((t) => t.name),
    ["aws_s3_bucket", "aws_lb", "random_password"],
  );
  assert.deepEqual(
    found.sources.map((s) => s.name),
    ["hashicorp/aws"],
  );
  assert.equal(found.types[0].where, "main.tf:1");
});

const usage = (over) => ({
  packages: [],
  actions: [],
  terraform: { types: [], sources: [] },
  ...over,
});

test("コードで使っている物が台帳にあれば問題なし", () => {
  const found = usage({
    packages: [
      { name: "@aws-sdk/client-s3", where: "p" },
      { name: "zod", where: "p" },
    ],
    actions: [{ name: "actions/checkout", where: "w" }],
    terraform: {
      types: [
        { name: "aws_s3_bucket", where: "t" },
        { name: "aws_lb", where: "t" },
        { name: "random_password", where: "t" },
      ],
      sources: [
        { name: "hashicorp/aws", where: "t" },
        { name: "hashicorp/random", where: "t" },
      ],
    },
  });
  assert.deepEqual(checkUsage(ledger, found), []);
});

test("台帳に無い SDK・Actions・提供者・AWS のサービスは落ちる", () => {
  const found = usage({
    packages: [{ name: "@sentry/node", where: "apps/api/package.json" }],
    actions: [{ name: "slackapi/slack-github-action", where: "w.yml:3" }],
    terraform: {
      types: [
        { name: "aws_sqs_queue", where: "q.tf:1" },
        { name: "google_storage_bucket", where: "g.tf:1" },
      ],
      sources: [{ name: "hashicorp/google", where: "v.tf:2" }],
    },
  });
  const out = checkUsage(ledger, found).join("\n");
  assert.match(out, /@sentry\/node」が台帳に無い/);
  assert.match(out, /slackapi\/slack-github-action」が台帳に無い/);
  assert.match(out, /aws_sqs_queue」が、どのサービスにも無い/);
  assert.match(out, /google_storage_bucket」の提供者\(google\)が台帳に無い/);
  assert.match(out, /hashicorp\/google」が台帳に無い/);
});

test("使うのをやめた会社(ended)では通らない", () => {
  const ended = { vendors: [{ ...github, status: "ended", ended_on: "2026-10-01" }] };
  assert.match(
    checkUsage(ended, usage({ actions: [{ name: "actions/checkout", where: "w" }] })).join(),
    /台帳に無い/,
  );
});

test("人が読む一覧に、会社・区分・使っている所が出る", () => {
  const found = usage({
    packages: [{ name: "@aws-sdk/client-s3", where: "p" }],
    actions: [{ name: "actions/checkout", where: "w" }],
  });
  const md = renderVendors(ledger, usageByVendor(ledger, found));
  assert.match(md, /生成物。手で直さない/);
  assert.match(md, /\| AWS \| 委託 \| 日本 \| internal・personal \| 約款に含む \|/);
  assert.match(md, /コードで使っている SDK: `@aws-sdk\/client-s3`/);
  assert.match(md, /\| ALB \| personal \| `aws_lb`・`aws_lb_\*` \|/);
  assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"));
});
