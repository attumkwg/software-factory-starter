// pnpm setup:check の中身(GitHub を読まない確かめ)のテスト。ファイルは偽物の src で渡す。
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAll } from "./check-lib.mjs";
import { validateLabels } from "./config.mjs";
import { labelsInText, readWorkflow } from "./usage.mjs";

const label = (name) => ({ name, color: "ededed", description: name });
const setupWith = (over = {}) => ({
  version: 1,
  template_repository: "kit/starter",
  template_schedules: [],
  ruleset: { name: "main", required_checks: ["lint"] },
  environments: [{ name: "prod", branches: ["main"] }],
  ...over,
});
const srcOf = (files) => ({
  read: (f) => files[f],
  list: (dir) =>
    Object.keys(files)
      .filter((f) => f.startsWith(`${dir}/`))
      .sort(),
});
const PR_WORKFLOW = "on: pull_request\njobs:\n  lint:\n    name: lint\n    runs-on: x\n";

test("ラベルの使われ方を拾う: フラグ・カンマ・ラベルの名前の比べ・定数", () => {
  const text = [
    "gh issue create --label kind:bug --label risk:<high|low>",
    'gh pr edit --add-label a,b --remove-label="c"',
    "if: github.event.label.name == 'vrt:update'",
    "contains(github.event.pull_request.labels.*.name, 'd')",
    'export const URGENT_LABEL = "checkup-urgent";',
    "`--label checkup` で探す。",
    '"--label", labels',
    '--label "$LABEL"',
  ].join("\n");
  assert.deepEqual(labelsInText(text).sort(), [
    "a",
    "b",
    "c",
    "checkup",
    "checkup-urgent",
    "d",
    "kind:bug",
    "vrt:update",
  ]);
});

test("一覧に無いラベルを使っていれば落ち、使っていないラベルは表示だけ", () => {
  const src = srcOf({
    ".github/labeler.yml": '"risk:high":\n  - x\n',
    ".github/ISSUE_TEMPLATE/bug.yml": 'labels: ["kind:bug"]\n',
    "renovate.json": JSON.stringify({
      labels: ["dependencies"],
      packageRules: [{ addLabels: ["deep"] }],
    }),
    ".github/workflows/ci.yml": PR_WORKFLOW,
    ".claude/skills/x/SKILL.md": "`gh issue list --label checkup`",
    "scripts/a.mjs": 'const LABEL = "from-script";',
    "scripts/a.test.mjs": 'const LABEL = "only-in-test";',
    "scripts/setup/usage.mjs": "// --label example",
  });
  const labels = ["risk:high", "kind:bug", "dependencies", "checkup", "spare"].map(label);
  const r = checkAll({ setup: setupWith(), labels, src });
  assert.deepEqual(r.unused, ["spare"]);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems.join("\n"), /deep が .*renovate\.json/);
  assert.match(r.problems.join("\n"), /from-script が .*scripts\/a\.mjs/);
});

test("必須のチェックは PR で動くジョブの名前と突き合わせる(matrix を広げる)", () => {
  const wf = [
    "on: [pull_request, push]",
    "jobs:",
    "  image:",
    `    name: イメージ(\${{ matrix.app }})`,
    "    strategy:",
    "      matrix:",
    "        app: [api, web]",
    "        include:",
    "          - app: mail",
  ].join("\n");
  assert.deepEqual(readWorkflow(wf).jobs[0].names, [
    "イメージ(api)",
    "イメージ(web)",
    "イメージ(mail)",
  ]);
  const src = srcOf({
    ".github/workflows/ci.yml": wf,
    ".github/workflows/nightly.yml": "on: workflow_dispatch\njobs:\n  only:\n    name: 夜だけ\n",
  });
  const setup = setupWith({
    ruleset: { name: "main", required_checks: ["イメージ(mail)", "夜だけ", "消えた"] },
  });
  const r = checkAll({ setup, labels: [], src });
  assert.deepEqual(
    r.problems.map((p) => p.match(/「(.+?)」/)[1]),
    ["夜だけ", "消えた"],
  );
});

test("ワークフローと点検が使う Environment は setup.yml に要る", () => {
  const src = srcOf({
    ".github/workflows/ci.yml": PR_WORKFLOW,
    ".github/workflows/deploy.yml": `on: workflow_dispatch\njobs:\n  a:\n    environment: prod\n  b:\n    environment:\n      name: stg\n  c:\n    environment: \${{ inputs.env }}\n`,
  });
  const r = checkAll({
    setup: setupWith(),
    labels: [],
    src,
    checkupEnvironments: ["prod", "claude"],
  });
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0], /deploy\.yml の b が使う Environment stg/);
  assert.match(r.problems[1], /点検(.*)が見る Environment claude/);
});

test("定期で動くワークフローは、needs の無いジョブ全部に KIT_ROLE の見分けが要る", () => {
  const gate = "    if: github.event_name != 'schedule' || vars.KIT_ROLE == 'product'\n";
  const scheduled = (jobs) =>
    `on:\n  schedule:\n    - cron: "0 0 * * 1"\n  workflow_dispatch:\njobs:\n${jobs}`;
  const files = {
    ".github/workflows/ci.yml": PR_WORKFLOW,
    ".github/workflows/gated.yml": scheduled(`  a:\n${gate}  b:\n    needs: a\n    if: always()\n`),
    ".github/workflows/open.yml": scheduled("  a:\n    runs-on: x\n"),
    ".github/workflows/allowed.yml": scheduled("  a:\n    runs-on: x\n"),
    ".github/workflows/commented.yml":
      "on:\n  workflow_dispatch:\n  # schedule:\n  #   - cron: x\njobs:\n  a: {}\n",
  };
  const setup = setupWith({ template_schedules: [{ file: "allowed.yml", why: "キットにも要る" }] });
  const r = checkAll({ setup, labels: [], src: srcOf(files) });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /open\.yml は定期で動くのに、a の if に/);
});

test("ラベルの一覧の書き方: 色・説明の長さ・大文字小文字の重なり", () => {
  const problems = validateLabels([
    label("ok"),
    { name: "bad-color", color: "#fff", description: "x" },
    { name: "long", color: "ededed", description: "あ".repeat(101) },
    label("OK"),
  ]);
  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /bad-color の color/);
  assert.match(problems.join("\n"), /long の description/);
  assert.match(problems.join("\n"), /OK が2回/);
});

test("設定の書き方が違えば、ほかを見ずにそれを返す", () => {
  const r = checkAll({ setup: { version: 2 }, labels: [], src: srcOf({}) });
  assert.ok(r.problems.some((p) => p.includes("version")));
  assert.ok(r.problems.some((p) => p.includes("required_checks")));
});
