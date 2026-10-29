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
const run = (gh, files, today = "2026-11-02") =>
  plan({ gh, setup, labels, src: srcOf(files), today });
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

test("マージキュー: enabled なら規則を足し、false なら外す。書かなければ画面で足した物を残す(仕様 0095)", () => {
  const withQueue = (enabled, strict) => ({
    ...setup,
    ruleset: { ...setup.ruleset, strict, merge_queue: { ...setup.ruleset.merge_queue, enabled } },
  });
  const runWith = (gh, s) => plan({ gh, setup: s, labels, src: srcOf(), today: "2026-11-02" });
  const gh = fakeGitHub();
  apply(runWith(gh, setup));
  // 入れる: キューの規則を足し、最新に追いついてから(strict)を外す
  const on = withQueue(true, false);
  const text = entriesOf(runWith(gh, on), "ルールセット")[0].text;
  assert.match(text, /マージキューを足す/);
  assert.match(text, /最新に追いついてから: true → false/);
  apply(runWith(gh, on));
  const queue = gh.state.rulesets[0].rules.find((r) => r.type === "merge_queue");
  assert.equal(queue.parameters.merge_method, "SQUASH");
  assert.equal(queue.parameters.grouping_strategy, "ALLGREEN");
  assert.equal(queue.parameters.do_not_enforce_on_create, undefined);
  assert.equal(countDiffs(runWith(gh, on)), 0);
  // 書かなければ扱わない(画面で足したキューを残す)
  const { merge_queue: _, ...noKey } = on.ruleset;
  assert.equal(countDiffs(runWith(gh, { ...setup, ruleset: noKey })), 0);
  // 外す
  assert.match(
    entriesOf(runWith(gh, withQueue(false, false)), "ルールセット")[0].text,
    /マージキューを外す/,
  );
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

test("作り始めるときに、キットの古くなった所を知らせる(作った後の更新・取り込みの古さ・見直す日)", () => {
  const gh = fakeGitHub((s) => {
    s.kitUpdatedAt = "2026-12-10T09:00:00Z";
  });
  const ledger = [
    "refreshed_on: 2026-09-01",
    "owners:",
    '  responder: "@alice"',
    "items:",
    "  - { id: old-one, status: open, review_by: 2026-12-01 }",
    "  - { id: gone, status: retired, review_by: 2026-01-01 }",
  ].join("\n");
  const text = run(gh, { "docs/checkup/todo.yaml": ledger }, "2026-12-15")
    .steps.map((s) => s.text)
    .join("\n");
  assert.match(text, /作った後\(2026-11-01\)にキットが更新されている\(最後 2026-12-10\)/);
  assert.match(text, /取り込んだのは 105日前/);
  assert.match(text, /見直す日の過ぎた項目 1件\(old-one\)/);
  const kit = fakeGitHub((s) => {
    s.repo.full_name = setup.template_repository;
    s.kitUpdatedAt = "2026-12-10T09:00:00Z";
  });
  assert.doesNotMatch(
    run(kit, { "docs/checkup/todo.yaml": ledger }, "2026-12-15")
      .steps.map((s) => s.text)
      .join("\n"),
    /キットが更新|取り込んだのは/,
  );
});

test("キットに版があれば、取り込んだ版(docs/kit/upstream.yaml)と比べて CHANGELOG と手引きへ案内する", () => {
  const upstream = (v) => ({
    "docs/kit/upstream.yaml": `repository: ${setup.template_repository}\nversion: ${v}\n`,
  });
  const gh = fakeGitHub((s) => {
    s.kitUpdatedAt = "2026-12-10T09:00:00Z";
    s.kitLatest = "v0.3.0";
  });
  const behind = run(gh, upstream("v0.2.4"))
    .steps.map((s) => s.text)
    .join("\n");
  assert.match(behind, /新しい版 v0\.3\.0.*取り込んだのは v0\.2\.4.*手が要る/);
  assert.match(behind, /CHANGELOG\.md.*docs\/kit\/upgrade\.md/);
  assert.doesNotMatch(behind, /作った後/);
  const latest = run(gh, upstream("v0.3.0"))
    .steps.map((s) => s.text)
    .join("\n");
  assert.doesNotMatch(latest, /新しい版|作った後/);
  // 版がまだ無いあいだは日付で、CHANGELOG の「未リリース」へ
  const noRelease = fakeGitHub((s) => {
    s.kitUpdatedAt = "2026-12-10T09:00:00Z";
  });
  assert.match(
    run(noRelease, upstream("null"))
      .steps.map((s) => s.text)
      .join("\n"),
    /キットが更新されている.*未リリース.*docs\/kit\/upgrade\.md/,
  );
});

test("人がやること: SECURITY.md がキットの窓口のままなら書き換えを知らせる", () => {
  const text = (body) =>
    run(fakeGitHub(), { "SECURITY.md": body })
      .steps.map((s) => s.text)
      .join("\n");
  assert.match(text(readFileSync("SECURITY.md", "utf8")), /SECURITY\.md がキットの窓口のまま/);
  assert.doesNotMatch(text("# 穴の知らせ方\n窓口は security@example.com"), /SECURITY\.md/);
});

test("人がやること: キットへの貢献の入口(CONTRIBUTING.md・キット用の Issue のテンプレート)が残っていれば知らせる", () => {
  const text = (files) =>
    run(fakeGitHub(), files)
      .steps.map((s) => s.text)
      .join("\n");
  const kit = Object.fromEntries(
    [
      "CONTRIBUTING.md",
      ".github/ISSUE_TEMPLATE/kit-gap.yml",
      ".github/ISSUE_TEMPLATE/kit-fix.yml",
    ].map((f) => [f, readFileSync(f, "utf8")]),
  );
  assert.match(
    text(kit),
    /貢献の入口が残っている\(CONTRIBUTING\.md・.*kit-gap\.yml・.*kit-fix\.yml\)/,
  );
  // 自分の物に書き換えた CONTRIBUTING.md だけなら(キット用のテンプレートは消した後)出ない
  assert.doesNotMatch(text({ "CONTRIBUTING.md": "# 貢献のしかた\n社内の手順" }), /貢献の入口/);
});
