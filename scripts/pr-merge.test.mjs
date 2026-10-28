import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkState, prProblems, requiredChecksFrom } from "./pr-merge-lib.mjs";

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
