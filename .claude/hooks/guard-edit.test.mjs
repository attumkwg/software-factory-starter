// guard-edit.mjs のテスト(`pnpm guards` で流れる)。聞くべき場所と、聞いてはいけない場所。外したときの振る舞い。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decide, hookOutput, relativePath, writtenText } from "./guard-edit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { paths } = JSON.parse(readFileSync(join(here, "protected-paths.json"), "utf8"));
const root = "/repo";
const optedOut = { KIT_EDIT_GUARD: "pr" };
// 手元の env(KIT_EDIT_GUARD)に引きずられないよう、既定は空の env で見る
const decision = (file, env = {}) => decide(file, root, env)?.decision ?? "allow";
// 一覧の1件ごとに、当たるはずのファイル("x/**" は x の下の1つ)
const sample = (p) => (p.endsWith("/**") ? `${p.slice(0, -2)}sub/file.ts` : p);

test("一覧の場所はどれも聞く(絶対の道でも、根からの道でも)", () => {
  for (const p of paths) {
    assert.equal(decision(`${root}/${sample(p)}`), "ask", p);
    assert.equal(decision(sample(p)), "ask", p);
  }
});

test("worktree の中の一覧の場所も聞く", () => {
  assert.equal(decision(`${root}/.claude/worktrees/feat-x/infra/terraform/main.tf`), "ask");
  assert.equal(
    relativePath(`${root}/.claude/worktrees/feat-x/.github/ci.yml`, root),
    ".github/ci.yml",
  );
});

test("関係の無い場所は聞かない", () => {
  for (const f of [
    `${root}/apps/api/src/domains/tasks/routes.ts`,
    `${root}/docs/guides/local-guards.md`,
    `${root}/apps/api/src/authorization.ts`,
    `${root}/infrastructure/notes.md`,
    `${root}/.claude/skills/bet/SKILL.md`,
    `${root}/renovate.json5`,
    "/elsewhere/infra/main.tf",
  ]) {
    assert.equal(decision(f), "allow", f);
  }
});

test("KIT_EDIT_GUARD=pr のときは聞かずに通し、理由だけ見せる", () => {
  for (const p of paths) assert.equal(decision(`${root}/${sample(p)}`, optedOut), "pass", p);
  assert.equal(decision(`${root}/apps/api/src/domains/tasks/routes.ts`, optedOut), "allow");
  const out = hookOutput(decide(`${root}/infra/main.tf`, root, optedOut));
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
  assert.match(out.systemMessage, /PR の危険度と人に判断してほしい所で確かめる/);
});

test("pr 以外の値は既定のまま聞く", () => {
  for (const v of ["", "off", "PR", "1"]) {
    assert.equal(decision(`${root}/infra/main.tf`, { KIT_EDIT_GUARD: v }), "ask", v);
  }
});

test("持ち主のスイッチを設定のファイルに書くのは、いつでも止める(KIT_EDIT_GUARD=pr でも。ADR 0086)", () => {
  const on = '{ "env": { "KIT_AI_MERGE": "slack" } }';
  for (const env of [{}, optedOut]) {
    assert.equal(decide(`${root}/.claude/settings.local.json`, root, env, on)?.decision, "deny");
    // 自分の設定(~/.claude/settings.json)も。Windows の道でも
    assert.equal(decide("/home/me/.claude/settings.json", root, env, on)?.decision, "deny");
    assert.equal(decide("C:\\Users\\me\\.claude\\settings.json", root, env, on)?.decision, "deny");
    assert.equal(
      decide(".claude/settings.json", root, env, '"KIT_EDIT_GUARD": "pr"')?.decision,
      "deny",
    );
    assert.equal(
      decide(`${root}/.claude/worktrees/feat-x/.claude/settings.local.json`, root, env, on)
        ?.decision,
      "deny",
    );
  }
  // スイッチの無い中身はふだんどおり(settings.local.json は守る場所でない・settings.json は聞く)
  assert.equal(decide(`${root}/.claude/settings.local.json`, root, {}, '{ "env": {} }'), null);
  assert.equal(decide(`${root}/.claude/settings.json`, root, {}, "{}")?.decision, "ask");
  // 文書でスイッチの名前を書くのは止めない
  assert.equal(decide(`${root}/docs/guides/local-guards.md`, root, {}, on), null);
  // 名前の一部が同じだけの物は止めない
  assert.equal(decide(`${root}/.claude/settings.local.json`, root, {}, "MY_KIT_AI_MERGED"), null);
});

test("書こうとしている中身は Edit・Write・MultiEdit のどれからも読む", () => {
  assert.equal(writtenText({ new_string: "a" }), "a");
  assert.equal(writtenText({ content: "b" }), "b");
  assert.equal(writtenText({ edits: [{ new_string: "c" }, { new_string: "d" }] }), "c\nd");
  assert.equal(writtenText(undefined), "");
});

// フックとして呼んだとき(標準入力に Claude Code の JSON)
const runHook = (input, env) =>
  spawnSync(process.execPath, [join(here, "guard-edit.mjs")], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: root, ...env },
  }).stdout;

test("フックとして: Edit・Write・NotebookEdit の道を見て ask を返す", () => {
  const edit = JSON.parse(
    runHook({ tool_name: "Edit", tool_input: { file_path: `${root}/.github/x.yml` } }),
  );
  assert.equal(edit.hookSpecificOutput.permissionDecision, "ask");
  const nb = JSON.parse(
    runHook({ tool_name: "NotebookEdit", tool_input: { notebook_path: `${root}/infra/a.ipynb` } }),
  );
  assert.equal(nb.hookSpecificOutput.permissionDecision, "ask");
  assert.equal(runHook({ tool_name: "Write", tool_input: { file_path: `${root}/README.md` } }), "");
});

test("フックとして: KIT_EDIT_GUARD=pr なら確認を返さない", () => {
  const out = JSON.parse(
    runHook({ tool_name: "Write", tool_input: { file_path: `${root}/infra/a.tf` } }, optedOut),
  );
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
  assert.ok(out.systemMessage);
});

test("フックとして: 設定のファイルにスイッチを書く MultiEdit は deny を返す", () => {
  const out = JSON.parse(
    runHook(
      {
        tool_name: "MultiEdit",
        tool_input: {
          file_path: `${root}/.claude/settings.local.json`,
          edits: [{ old_string: "{}", new_string: '{ "env": { "KIT_AI_MERGE": "slack" } }' }],
        },
      },
      optedOut,
    ),
  );
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
});
