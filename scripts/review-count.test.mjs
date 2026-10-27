import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvers,
  isHighRisk,
  isProtected,
  judge,
  requiredFromSetup,
} from "./review-count-lib.mjs";

const paths = ["infra/**", "CLAUDE.md", "apps/api/src/auth/**"];
const user = (login, type = "User") => ({ login, type });
const review = (login, state, extra = {}) => ({
  user: user(login, extra.type),
  state,
  author_association: extra.association ?? "MEMBER",
});

test("守るパスの当たり方は guard-edit と同じ(/** は下の全部・ほかは同じ名前だけ)", () => {
  assert.equal(isProtected("infra/envs/prod/main.tf", paths), true);
  assert.equal(isProtected("CLAUDE.md", paths), true);
  assert.equal(isProtected("apps/api/CLAUDE.md", paths), false);
  assert.equal(isProtected("infrastructure.md", paths), false);
});

test("高かどうか: ファイル・名前を変えた元の名前・ラベル", () => {
  assert.equal(isHighRisk({ files: [{ filename: "docs/a.md" }], labels: [], paths }), false);
  assert.equal(isHighRisk({ files: [{ filename: "infra/x.tf" }], labels: [], paths }), true);
  const moved = [{ filename: "docs/old-auth.ts", previous_filename: "apps/api/src/auth/x.ts" }];
  assert.equal(isHighRisk({ files: moved, labels: [], paths }), true);
  assert.equal(isHighRisk({ files: [], labels: ["risk:high"], paths }), true);
});

test("承認: 人ごとの最後の判断・出した人とボットと外の人は数えない・コメントは判断を変えない", () => {
  const reviews = [
    review("a", "APPROVED"),
    review("b", "APPROVED"),
    review("b", "CHANGES_REQUESTED"),
    review("c", "APPROVED", { association: "COLLABORATOR" }),
    review("c", "COMMENTED"),
    review("d", "APPROVED"),
    review("d", "DISMISSED"),
    review("author", "APPROVED", { association: "OWNER" }),
    review("renovate[bot]", "APPROVED", { type: "Bot" }),
    review("stranger", "APPROVED", { association: "NONE" }),
    review("past", "APPROVED", { association: "CONTRIBUTOR" }),
    { user: null, state: "APPROVED", author_association: "MEMBER" },
  ];
  assert.deepEqual(approvers({ reviews, author: "author" }), ["a", "c"]);
});

test("人数は setup.yml の ruleset.high_risk_approvals。無ければ 0", () => {
  assert.equal(
    requiredFromSetup("ruleset:\n  name: main\n  high_risk_approvals: 2 # 高は2人\n"),
    2,
  );
  assert.equal(requiredFromSetup("ruleset:\n  name: main\n"), 0);
});

test("判定: 高でない・人数0・足りる・足りない", () => {
  assert.equal(judge({ high: false, required: 2, approved: [] }).ok, true);
  assert.equal(judge({ high: true, required: 0, approved: [] }).ok, true);
  assert.equal(judge({ high: true, required: 2, approved: ["a", "b"] }).ok, true);
  const short = judge({ high: true, required: 2, approved: ["a"] });
  assert.equal(short.ok, false);
  assert.match(short.message, /あと 1 人/);
});
