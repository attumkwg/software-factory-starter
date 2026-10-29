import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  bodySaysHigh,
  checkState,
  humanOnlyReasons,
  mergeQueueOn,
  prProblems,
  requiredChecksFrom,
  SENSOR_MARK,
  sensorComment,
  sensorMergeBlockers,
  sensorsOnlyFrom,
} from "./pr-merge-lib.mjs";

test("setup.yml の必須のチェックを、注を外して読む", () => {
  const checks = requiredChecksFrom(readFileSync(".github/setup.yml", "utf8"));
  assert.ok(checks.includes("Biome・型・単体"));
  assert.ok(checks.includes("取り組みと作業の種類(PR の本文)"));
  assert.ok(checks.every((c) => !c.includes("#")));
});

const run = (name, conclusion, status = "completed") => ({ name, status, conclusion });

test("必須のチェックが全部緑のときだけ green。足りない・途中は待つ・落ちたら failed", () => {
  const required = ["A", "B"];
  assert.equal(checkState(required, [run("A", "success"), run("B", "skipped")]).green, true);
  assert.deepEqual(checkState(required, [run("A", "success")]).pending, ["B"]);
  assert.deepEqual(
    checkState(required, [run("A", "success"), run("B", null, "in_progress")]).pending,
    ["B"],
  );
  assert.deepEqual(checkState(required, [run("A", "failure"), run("B", "success")]).failed, [
    "A(failure)",
  ]);
});

test("同じ名前が何度も流れたら、新しい方(先頭)を見る", () => {
  const state = checkState(["A"], [run("A", "success"), run("A", "failure")]);
  assert.equal(state.green, true);
});

test("開いていない・下書き・main 向けでない PR はマージしない", () => {
  const ok = { state: "open", draft: false, base: { ref: "main" } };
  assert.deepEqual(prProblems(ok), []);
  assert.equal(prProblems({ ...ok, state: "closed" }).length, 1);
  assert.equal(prProblems({ ...ok, draft: true }).length, 1);
  assert.equal(prProblems({ ...ok, base: { ref: "release" } }).length, 1);
});

test("危険度「高」・テストを弱めた印・守りの場所に触る PR は、人の答えが要る(1人の間は会話の答えを記録してマージ)", () => {
  const protectedPaths = JSON.parse(
    readFileSync(".claude/hooks/protected-paths.json", "utf8"),
  ).paths;
  const ok = { labels: ["risk:low"], files: ["apps/web/src/pages/TasksPage.tsx"], protectedPaths };
  assert.deepEqual(humanOnlyReasons(ok), []);
  for (const labels of [["risk:high"], ["tests:weakened"]]) {
    assert.equal(humanOnlyReasons({ ...ok, labels }).length, 1, labels[0]);
  }
  for (const file of [
    ".github/workflows/ci.yml",
    ".claude/skills/slack-request/SKILL.md",
    "CLAUDE.md",
    "scripts/pr-merge-lib.mjs",
    "apps/api/src/authz/policy.ts",
    "apps/api/drizzle/0024_member_roles.sql",
  ]) {
    assert.equal(humanOnlyReasons({ ...ok, files: [file] }).length, 1, file);
  }
});

test("センサーだけで入れるかのスイッチ(ai_merge.sensors_only)は、書いていなければ false(ADR 0094)", () => {
  assert.equal(sensorsOnlyFrom(readFileSync(".github/setup.yml", "utf8")), false);
  assert.equal(sensorsOnlyFrom("ai_merge:\n  sensors_only: true\n"), true);
  assert.equal(sensorsOnlyFrom("ai_merge: # 注\n\n  sensors_only: true # 注\n"), true);
  assert.equal(sensorsOnlyFrom("ai_merge:\n  sensors_only: false\n"), false);
  // ほかの節の同じ名前は読まない
  assert.equal(sensorsOnlyFrom("ai_merge:\nother:\n  sensors_only: true\n"), false);
  assert.equal(sensorsOnlyFrom("other:\n  sensors_only: true\n"), false);
  assert.equal(sensorsOnlyFrom(undefined), false);
});

test("人を呼ぶ理由が1つでもあれば、センサーだけでは入れない(ADR 0094)", () => {
  const protectedPaths = JSON.parse(
    readFileSync(".claude/hooks/protected-paths.json", "utf8"),
  ).paths;
  const low = {
    labels: ["risk:low"],
    files: ["apps/web/src/pages/TasksPage.tsx"],
    protectedPaths,
    body: "## ⚠️ 危険度\n\n- [x] 低: 文言\n- [ ] 高: 認証",
    questionCount: 0,
    touchedAreaNames: [],
  };
  assert.deepEqual(sensorMergeBlockers(low), []);
  const one = (over) => sensorMergeBlockers({ ...low, ...over });
  assert.match(one({ labels: ["needs-human"] }).join(), /needs-human/);
  assert.match(one({ labels: ["risk:high"] }).join(), /risk:high/);
  assert.match(one({ labels: ["tests:weakened"] }).join(), /tests:weakened/);
  assert.match(one({ questionCount: 1 }).join(), /問いが 1 つ/);
  assert.match(one({ body: "- [X] 高: CI の設定" }).join(), /本文の危険度が「高」/);
  assert.match(one({ touchedAreaNames: ["課金"] }).join(), /課金/);
  assert.match(one({ files: [".github/setup.yml"] }).join(), /守りの場所/);
  assert.equal(bodySaysHigh("- [ ] 高: 認証"), false);
});

test("センサーだけで入れた記録と、マージキューの見分け", () => {
  const c = sensorComment({ sha: "abcdef0123456789", required: 16, queued: true });
  assert.ok(c.startsWith(SENSOR_MARK));
  assert.match(c, /`abcdef0`/);
  assert.match(c, /16 件が全部緑/);
  assert.match(c, /マージキューに並べた/);
  assert.equal(mergeQueueOn([{ type: "pull_request" }, { type: "merge_queue" }]), true);
  assert.equal(mergeQueueOn([{ type: "required_status_checks" }]), false);
  assert.equal(mergeQueueOn(undefined), false);
});
