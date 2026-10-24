// pnpm setup:github の中身(差分・反映・人がやること)のテスト。偽物の GitHub(fake-github.mjs)に対して流す。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { isDiff } from "./entries.mjs";
import { fakeGitHub } from "./fake-github.mjs";
import { apply, countDiffs, plan, render } from "./plan.mjs";

// 本物の設定ファイルで流す(設定ファイルの形が、スクリプトの読み方とずれていないかも見る)
const setup = parse(readFileSync(".github/setup.yml", "utf8"));
const labels = parse(readFileSync(".github/labels.yml", "utf8")).labels;
const srcOf = (files = {}) => ({ read: (f) => files[f] });
const run = (gh, files) => plan({ gh, setup, labels, src: srcOf(files) });
const entriesOf = (result, title) => result.areas.find((a) => a.title.startsWith(title)).entries;

test("試しは読むだけで、何も書かない。区分ごとの差分が出る", () => {
  const gh = fakeGitHub();
  const r = run(gh);
  assert.equal(gh.calls.length, 0);
  assert.equal(r.role, "product");
  assert.ok(countDiffs(r) > 10);
  const text = render(r);
  assert.match(text, /試し: 何も書き換えていない/);
  assert.match(text, /ルールセット main/);
  assert.match(text, /KIT_ROLE=product を作る/);
  assert.match(text, /一覧に無いラベル\(消さない\): bug/);
});

test("--apply のあとに読み直すと差分は 0件(何度流しても同じ)。消さない・秘密を書かない", () => {
  const gh = fakeGitHub();
  const results = apply(run(gh));
  assert.ok(
    results.every((x) => x.ok),
    JSON.stringify(results.filter((x) => !x.ok)),
  );
  const again = run(gh);
  assert.equal(countDiffs(again), 0, render(again));
  assert.equal(apply(again).length, 0);
  assert.equal(gh.state.variables.KIT_ROLE, "product");
  assert.ok(gh.state.labels.some((l) => l.name === "bug"));
  assert.ok(!gh.calls.some((c) => c.sub.includes("secrets")));
  assert.ok(!gh.calls.some((c) => c.method === "DELETE" && c.sub.startsWith("labels")));
  const prod = gh.state.environments.prod;
  assert.deepEqual(
    prod.policies.map((p) => p.name),
    ["main"],
  );
  assert.equal(prod.env.protection_rules[0].reviewers[0].reviewer.login, "alice");
});

test("ひな形の名前なら KIT_ROLE=template。リポジトリの秘密は聞かず、人がやることは Renovate だけ", () => {
  const gh = fakeGitHub((s) => {
    s.repo.full_name = setup.template_repository;
  });
  const r = run(gh, { ".github/CODEOWNERS": "* @attumkwg" });
  assert.equal(r.role, "template");
  assert.match(render(r), /KIT_ROLE=template を作る/);
  assert.equal(entriesOf(r, "リポジトリの秘密")[0].state, "skip");
  assert.equal(r.steps.length, 1);
});

test("ルールセット: 扱わない規則と鍵は残し、例外は外し、足りないチェックを足す", () => {
  const checks = setup.ruleset.required_checks
    .slice(1)
    .map((context) => ({ context, integration_id: 15368 }));
  const gh = fakeGitHub((s) => {
    s.rulesets.push({
      id: 7,
      name: "main",
      target: "branch",
      enforcement: "active",
      bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5 }],
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [
        { type: "code_scanning", parameters: { tools: [] } },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            require_extra_approval_for_unattributed_changes: true,
          },
        },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [...checks, { context: "古い", integration_id: 15368 }],
          },
        },
      ],
    });
  });
  const text = entriesOf(run(gh), "ルールセット")[0].text;
  assert.match(text, /例外\(Bypass list\)を外す: 1件/);
  assert.match(text, new RegExp(`必須のチェックに足す: ${setup.ruleset.required_checks[0]}`));
  assert.match(text, /必須のチェックから外す: 古い/);
  assert.match(text, /消せないを足す/);
  apply(run(gh));
  const rs = gh.state.rulesets[0];
  assert.deepEqual(rs.bypass_actors, []);
  assert.ok(rs.rules.some((r) => r.type === "code_scanning"));
  const pr = rs.rules.find((r) => r.type === "pull_request").parameters;
  assert.equal(pr.require_extra_approval_for_unattributed_changes, true);
  assert.equal(countDiffs(run(gh)), 0);
});

test("Environments: main 以外の配備の決まりは外し、足りない秘密の名前は人がやることに", () => {
  const gh = fakeGitHub((s) => {
    s.environments.claude = {
      env: {
        name: "claude",
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        protection_rules: [],
      },
      policies: [
        { id: 1, name: "main", type: "branch" },
        { id: 2, name: "feature/*", type: "branch" },
      ],
    };
  });
  const entries = entriesOf(run(gh), "Environments");
  assert.ok(entries.some((e) => e.state === "remove" && e.text.includes("feature/*")));
  assert.ok(entries.some((e) => e.state === "todo" && e.text.includes("ANTHROPIC_API_KEY")));
});

test("読めない区分は「読めなかった」にしてほかを続け、反映の失敗は数える", () => {
  const gh = fakeGitHub();
  const get = gh.get;
  gh.get = (sub) =>
    sub.startsWith("actions/permissions/fork")
      ? { ok: false, status: 403, message: "Forbidden" }
      : get(sub);
  const r = run(gh);
  const actions = entriesOf(r, "Actions");
  assert.ok(actions.some((e) => e.state === "unknown" && e.text.includes("HTTP 403")));
  assert.ok(entriesOf(r, "ラベル").some(isDiff));
  const write = gh.write;
  gh.write = (method, sub, body) =>
    sub === "labels" ? { ok: false, status: 422, message: "nope" } : write(method, sub, body);
  const results = apply(r);
  assert.ok(results.some((x) => !x.ok && x.message.includes("422")));
  assert.ok(results.some((x) => x.ok));
});

test("非公開のリポジトリでは、公開だけの守りを飛ばす", () => {
  const gh = fakeGitHub((s) => {
    s.repo.visibility = "private";
  });
  const sec = entriesOf(run(gh), "守りの機能");
  for (const key of ["secret_scanning", "push_protection", "private_vulnerability_reporting"])
    assert.ok(
      sec.some((e) => e.state === "skip" && e.text.startsWith(key)),
      key,
    );
});

test("人がやること: CODEOWNERS と台帳がキットの持ち主のまま・計画が無い・取り込みを一度も流していない", () => {
  const owner = `@${setup.template_repository.split("/")[0]}`;
  const r = run(fakeGitHub(), {
    ".github/CODEOWNERS": `*   ${owner}`,
    "docs/checkup/todo.yaml": `started_on: 2026-10-17\nowners:\n  responder: "${owner}"\n`,
  });
  const text = r.steps.map((s) => s.text).join("\n");
  assert.match(text, /\/kickoff/);
  assert.match(text, /\/tailor/);
  assert.match(text, /CODEOWNERS/);
  assert.match(text, /pnpm checkup:adopt --by @alice/);
  assert.match(text, /最初の \/checkup-refresh/);
  const done = run(fakeGitHub(), {
    "docs/product/plan.md": "x",
    "docs/product/tailoring.md": "x",
    ".github/CODEOWNERS": "* @alice",
    "docs/checkup/todo.yaml": 'refreshed_on: 2026-11-01\nowners:\n  responder: "@alice"\n',
  });
  assert.equal(done.steps.length, 2);
});
