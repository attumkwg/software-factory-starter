// setup-drift(.github/setup.yml と GitHub の今の設定のずれ・G-74)のテスト。node --test scripts/checkup/setup-drift.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { desiredRules } from "../setup/areas-ruleset.mjs";
import { check as both } from "./checks/protection-and-envs.mjs";
import { check, environmentDrift, rulesetDrift } from "./checks/setup-drift.mjs";
import { err, fakeCtx, ok } from "./fake-context.mjs";

const SETUP_TEXT = readFileSync(".github/setup.yml", "utf8");
const SETUP = parse(SETUP_TEXT);
const files = { ".github/setup.yml": SETUP_TEXT };

/** setup.yml どおりの main の規則(GitHub の rules/branches/main の形) */
const liveFrom = (rs) => desiredRules(rs).map((r) => ({ ruleset_id: 1, ...r }));
const reviewer = (login) => ({ type: "User", reviewer: { login } });
const prodOk = {
  name: "prod",
  protection_rules: [
    { type: "required_reviewers", prevent_self_review: false, reviewers: [reviewer("owner")] },
  ],
};

test("setup-drift: setup.yml どおりなら合格", async () => {
  const r = await check(
    fakeCtx({
      files,
      api: {
        "rules/branches/main": ok(liveFrom(SETUP.ruleset)),
        environments: ok({ environments: [prodOk, { name: "stg" }] }),
      },
    }),
  );
  assert.equal(r.result, "pass", r.note);
});

test("setup-drift: 取り込んだ必須のチェックを --apply し忘れたら不合格(G-74 の場面)", () => {
  const live = liveFrom({
    ...SETUP.ruleset,
    required_checks: SETUP.ruleset.required_checks.slice(1),
  });
  const drift = rulesetDrift(SETUP.ruleset, live);
  assert.equal(drift.length, 1);
  assert.match(
    drift[0],
    new RegExp(`必須になっていないチェック: ${SETUP.ruleset.required_checks[0]}`),
  );
});

test("setup-drift: 画面で変えた設定(承認の数・最新に追いついてから・余計なチェック)を出す", () => {
  const live = liveFrom({
    ...SETUP.ruleset,
    required_approvals: 2,
    strict: false,
    required_checks: [...SETUP.ruleset.required_checks, "手で足した物"],
  });
  const drift = rulesetDrift(SETUP.ruleset, live).join(" / ");
  assert.match(drift, /承認の数: 2 → 0/);
  assert.match(drift, /最新に追いついてから: false → true/);
  assert.match(drift, /setup.yml に無い必須のチェック: 手で足した物/);
  assert.match(rulesetDrift(SETUP.ruleset, []).join(), /PR 必須の規則が無い/);
});

test("setup-drift: ルールセットが2つでも、合わせて見る(承認は多い方)", () => {
  const prRule = liveFrom(SETUP.ruleset).find((r) => r.type === "pull_request");
  const more = {
    ...prRule,
    ruleset_id: 2,
    parameters: { ...prRule.parameters, required_approving_review_count: 1 },
  };
  const live = [...liveFrom(SETUP.ruleset), more];
  assert.deepEqual(rulesetDrift(SETUP.ruleset, live), ["承認の数: 1 → 0"]);
});

test("setup-drift: Environments の承認する人(@me は人数だけ・名前の人は居るか・自分の承認)", () => {
  const want = [
    { name: "prod", reviewers: ["@me", "@second"], prevent_self_review: true },
    { name: "stg" },
  ];
  assert.deepEqual(
    environmentDrift(want, [
      {
        name: "prod",
        protection_rules: [
          {
            type: "required_reviewers",
            prevent_self_review: true,
            reviewers: [reviewer("a"), reviewer("second")],
          },
        ],
      },
    ]),
    [],
  );
  const drift = environmentDrift(want, [prodOk]).join(" / ");
  assert.match(drift, /prod の承認する人: 1人 → 2人/);
  assert.match(drift, /prod の承認する人に居ない: second/);
  assert.match(drift, /prod の自分の承認を止める: false → true/);
  assert.deepEqual(environmentDrift(want, []), [], "無い Environment は gh-envs が見る");
});

test("setup-drift: setup.yml が無い・GitHub が読めなければ unknown(合格にしない)", async () => {
  assert.equal((await check(fakeCtx({}))).result, "unknown");
  const noRules = await check(fakeCtx({ files, api: { "rules/branches/main": err(403, "x") } }));
  assert.equal(noRules.result, "unknown");
});

test("w-protection: setup.yml とのずれも不合格にする", async () => {
  const mainOnly = ok({ branch_policies: [{ name: "main", type: "branch" }] });
  const custom = { deployment_branch_policy: { custom_branch_policies: true } };
  const envs = ["stg", "prod", "claude"].map((name) => ({
    name,
    ...custom,
    ...(name === "prod" ? prodOk : {}),
  }));
  const api = (rules) => ({
    "rules/branches/main": ok(rules),
    environments: ok({ environments: envs }),
    "environments/*": mainOnly,
  });
  const pass = await both(fakeCtx({ files, api: api(liveFrom(SETUP.ruleset)) }));
  assert.equal(pass.result, "pass", pass.note);
  const stale = liveFrom({ ...SETUP.ruleset, required_checks: ["Biome・型・単体"] });
  const fail = await both(fakeCtx({ files, api: api(stale) }));
  assert.equal(fail.result, "fail");
  assert.match(fail.note, /pnpm setup:github/);
});
