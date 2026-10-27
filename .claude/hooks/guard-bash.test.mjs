// guard-bash.mjs のテスト(`pnpm guards` で流れる)。止めるべきものと、止めてはいけないもの。
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./guard-bash.mjs";

const onMain = () => "main";
const onFeature = () => "feat/x";
// 手元の env(KIT_EDIT_GUARD)に引きずられないよう、既定は空の env で見る
const decision = (command, branch = onFeature, env = {}) =>
  decide(command, branch, env)?.decision ?? "allow";
const optedOut = { KIT_EDIT_GUARD: "pr" };

test("main への push・危ない push は止める", () => {
  for (const c of [
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin feat/x:refs/heads/main",
    "git push -u origin +feat/x",
    "git push --force origin feat/x",
    "git push -f",
    "git push --force-with-lease origin feat/x",
    "git push origin --delete feat/x",
    "git push --no-verify origin feat/x",
    "git -C ../other push origin main",
    "pnpm lint && git push origin main",
  ]) {
    assert.equal(decision(c), "deny", c);
  }
});

test("main にいるときの省略した push も止める", () => {
  assert.equal(decision("git push", onMain), "deny");
  assert.equal(decision("git push origin HEAD", onMain), "deny");
});

test("ふつうの push は通す", () => {
  assert.equal(decision("git push -u origin feat/x"), "allow");
  assert.equal(decision("git push"), "allow");
  assert.equal(decision("git push origin HEAD"), "allow");
});

test("マージ・承認は止める", () => {
  assert.equal(decision("gh pr merge 12 --squash"), "deny");
  assert.equal(decision("gh pr review 12 --approve"), "deny");
  assert.equal(decision("gh api -X PUT repos/o/r/pulls/12/merge"), "deny");
  assert.equal(decision("gh pr review 12 --comment -b ok"), "allow");
  assert.equal(decision("gh pr view 12"), "allow");
});

test("危険度「高」の場所を書くコマンドは聞く", () => {
  for (const c of [
    "sed -i 's/a/b/' .github/workflows/ci.yml",
    "echo x > infra/terraform/main.tf",
    "cat a | tee .claude/settings.json",
    "cp /tmp/x apps/api/src/authz/policy.ts",
    "rm .gitleaksignore",
    "node -e \"require('fs').writeFileSync('renovate.json','{}')\"",
    "git checkout -- apps/api/drizzle/0001_rls.sql",
    "terraform -chdir=infra/terraform/envs/prod fmt",
    String.raw`echo x >> C:\repo\.claude\hooks\verify.mjs`,
    "find docker -name '*.cf' -delete",
  ]) {
    assert.equal(decision(c), "ask", c);
  }
});

test("読むだけなら聞かない", () => {
  for (const c of [
    "cat .github/workflows/ci.yml",
    "grep -rn foo infra/ 2>/dev/null",
    "sed -n 1,20p apps/api/src/auth/session.ts",
    "git diff origin/main -- .github/",
    "ls apps/api/drizzle && wc -l apps/api/drizzle/*.sql",
    "find infra -name '*.tf'",
    "git log --oneline -- docs/authz/matrix.yaml",
  ]) {
    assert.equal(decision(c), "allow", c);
  }
});

test("KIT_EDIT_GUARD=pr のときは、危険度「高」の場所の書き換えだけ聞かずに通す", () => {
  assert.equal(decision("sed -i 's/a/b/' .github/workflows/ci.yml", onFeature, optedOut), "pass");
  assert.equal(decision("echo x > infra/terraform/main.tf", onFeature, optedOut), "pass");
  assert.equal(
    decision("echo x > apps/api/src/domains/tasks/routes.ts", onFeature, optedOut),
    "allow",
  );
  assert.equal(decision("cat .github/workflows/ci.yml", onFeature, optedOut), "allow");
  // pr 以外の値は既定のまま聞く
  assert.equal(decision("rm .gitleaksignore", onFeature, { KIT_EDIT_GUARD: "off" }), "ask");
  assert.equal(decision("rm .gitleaksignore", onFeature, { KIT_EDIT_GUARD: "" }), "ask");
});

test("KIT_EDIT_GUARD=pr でも、止めるものは止める", () => {
  for (const c of [
    "git push origin main",
    "git push --force origin feat/x",
    "gh pr merge 12 --squash",
    "gh pr review 12 --approve",
    "git push origin --delete feat/x",
  ]) {
    assert.equal(decision(c, onFeature, optedOut), "deny", c);
  }
  assert.equal(decision("git push", onMain, optedOut), "deny");
});

test("関係の無い場所は聞かない", () => {
  assert.equal(decision("echo x > apps/api/src/domains/tasks/routes.ts"), "allow");
  assert.equal(decision("pnpm test"), "allow");
  assert.equal(decision("docker compose up -d db"), "allow");
});

test("未確定事項への人の答えを GitHub に書くコマンドは、KIT_EDIT_GUARD=pr でも聞く(G-61)", () => {
  for (const c of [
    'gh pr comment 12 --body "U-1 承認"',
    'gh issue comment 3 --body "U-2: 変更 こうする"',
    'gh pr review 12 --comment -b "U-3 保留"',
    "gh api repos/a/b/issues/12/comments -f body='U-1 承認'",
  ]) {
    assert.equal(decision(c, onFeature, optedOut), "ask", c);
  }
  // 仮決めの行を PR の本文に写す・答えと関係の無いコメントは聞かない
  assert.equal(decision('gh pr create --body "| U-1 | 設計 | 仮決め |"'), "allow");
  assert.equal(decision('gh pr comment 12 --body "CI を直しました"'), "allow");
});
