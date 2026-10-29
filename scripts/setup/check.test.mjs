// pnpm setup:check の中身(GitHub を読まない確かめ)のテスト。ファイルは偽物の src で渡す。
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAll, checkGuide } from "./check-lib.mjs";
import { validateLabels, validateSetup } from "./config.mjs";
import { LABELS_GUIDE, renderLabelsGuide } from "./labels-doc.mjs";
import { labelsInText, readWorkflow } from "./usage.mjs";

const label = (name, who = "自動(labeler)") => ({
  name,
  color: "ededed",
  description: name,
  group: "危険度",
  meaning: `${name} の意味`,
  who,
  when: "PR を開いたとき",
  action: "人が見る",
});
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
const PR_WORKFLOW =
  "on: [pull_request, merge_group]\njobs:\n  lint:\n    name: lint\n    runs-on: x\n";

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
  const labels = ["risk:high", "kind:bug", "dependencies", "checkup", "spare"].map((n) => label(n));
  const r = checkAll({ setup: setupWith(), labels, src });
  assert.deepEqual(r.unused, ["spare"]);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems.join("\n"), /deep が .*renovate\.json/);
  assert.match(r.problems.join("\n"), /from-script が .*scripts\/a\.mjs/);
});

test("必須のチェックは PR で動くジョブの名前と突き合わせる(matrix を広げる)", () => {
  const wf = [
    "on: [pull_request, push, merge_group]",
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

test("必須のチェックは、マージキューの中(merge_group)でも流れるワークフローに要る(仕様 0095)", () => {
  const src = srcOf({
    ".github/workflows/ci.yml": PR_WORKFLOW,
    ".github/workflows/pr-body.yml":
      "on:\n  pull_request:\n    types: [edited]\njobs:\n  body:\n    name: 本文\n",
  });
  const setup = setupWith({ ruleset: { name: "main", required_checks: ["lint", "本文"] } });
  const r = checkAll({ setup, labels: [], src });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /「本文」のワークフローに merge_group が無い/);
  // キューの中で if に飛ばされるジョブ(飛ばすと成功になる)も落とす
  const skip = srcOf({
    ".github/workflows/ci.yml": [
      "on: [pull_request, merge_group]",
      "jobs:",
      "  a:",
      "    name: 互換",
      "    if: github.event_name == 'pull_request'",
      "  b:",
      "    name: 両方",
      "    if: github.event_name == 'pull_request' || github.event_name == 'merge_group'",
    ].join("\n"),
  });
  const both = setupWith({ ruleset: { name: "main", required_checks: ["互換", "両方"] } });
  const problems = checkAll({ setup: both, labels: [], src: skip }).problems;
  assert.equal(problems.length, 1);
  assert.match(problems[0], /「互換」の if が pull_request だけ/);
});

test("マージキューの設定: 数の範囲・マージの方法・入れるなら strict は false(仕様 0095)", () => {
  const queue = {
    enabled: false,
    merge_method: "SQUASH",
    max_entries_to_build: 5,
    max_entries_to_merge: 5,
    min_entries_to_merge: 1,
    min_entries_to_merge_wait_minutes: 5,
    grouping_strategy: "ALLGREEN",
    check_response_timeout_minutes: 60,
  };
  const rs = (q, over = {}) => ({
    name: "main",
    required_checks: ["lint"],
    allowed_merge_methods: ["squash", "rebase"],
    strict: true,
    merge_queue: q,
    ...over,
  });
  const v = (q, over) => validateSetup(setupWith({ ruleset: rs(q, over) }));
  assert.deepEqual(v(queue), []);
  // 書かなければ扱わない(画面で足した物を残す)
  assert.deepEqual(v(undefined), []);
  assert.match(v({ ...queue, enabled: true }).join("\n"), /strict は false/);
  assert.deepEqual(v({ ...queue, enabled: true }, { strict: false }), []);
  assert.match(v({ ...queue, merge_method: "MERGE" }).join("\n"), /SQUASH か REBASE/);
  assert.match(
    v(queue, { allowed_merge_methods: ["rebase"] }).join("\n"),
    /allowed_merge_methods に無い/,
  );
  assert.match(
    v({ ...queue, max_entries_to_build: 0 }).join("\n"),
    /max_entries_to_build は 1〜100/,
  );
  assert.match(v({ ...queue, min_entries_to_merge: 6 }).join("\n"), /max_entries_to_merge 以下/);
  assert.match(v({ ...queue, grouping_strategy: "HEADGREEN" }).join("\n"), /ALLGREEN/);
  assert.match(
    validateSetup(setupWith({ ai_merge: { sensors_only: "yes" } })).join("\n"),
    /ai_merge.sensors_only は true か false/,
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

test("ラベルの一覧の書き方: 色・説明の長さ・大文字小文字の重なり・手引きに出す欄", () => {
  const { action: _action, ...noAction } = label("no-action");
  const problems = validateLabels([
    label("ok"),
    { ...label("bad-color"), color: "#fff" },
    { ...label("long"), description: "あ".repeat(101) },
    label("OK"),
    noAction,
  ]);
  assert.equal(problems.length, 4);
  assert.match(problems.join("\n"), /bad-color の color/);
  assert.match(problems.join("\n"), /long の description/);
  assert.match(problems.join("\n"), /OK が2回/);
  assert.match(problems.join("\n"), /no-action に action が無い/);
});

test("ラベルの手引きは一覧から作る: 人が付けるラベルを先に出し、古ければ落ちる", () => {
  const labels = [label("risk:high"), label("vrt:update", "人(手元に Docker が無いとき)")];
  const guide = renderLabelsGuide(labels);
  assert.match(guide, /人が手で付けるのは `vrt:update` だけ/);
  assert.match(guide, /\| `risk:high` \| risk:high の意味 \| 自動\(labeler\) \|/);
  assert.deepEqual(checkGuide(labels, srcOf({ [LABELS_GUIDE]: guide })), []);
  assert.equal(checkGuide(labels, srcOf({ [LABELS_GUIDE]: "古い" })).length, 1);
});

test("設定の書き方が違えば、ほかを見ずにそれを返す", () => {
  const r = checkAll({ setup: { version: 2 }, labels: [], src: srcOf({}) });
  assert.ok(r.problems.some((p) => p.includes("version")));
  assert.ok(r.problems.some((p) => p.includes("required_checks")));
});

test("危険度「高」の承認の人数は 0〜6 の整数で、ふつうの承認数より少なくしない(仕様 0059)", () => {
  const problems = (ruleset) =>
    validateSetup(setupWith({ ruleset: { name: "main", required_checks: ["lint"], ...ruleset } }));
  assert.deepEqual(problems({}), []);
  assert.deepEqual(problems({ high_risk_approvals: 2, required_approvals: 1 }), []);
  assert.ok(problems({ high_risk_approvals: -1 }).some((p) => p.includes("0〜6")));
  assert.ok(problems({ high_risk_approvals: "2" }).some((p) => p.includes("0〜6")));
  assert.ok(
    problems({ high_risk_approvals: 1, required_approvals: 2 }).some((p) => p.includes("以上")),
  );
});
