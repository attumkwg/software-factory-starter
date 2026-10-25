// record-outbound.mjs のテスト(`pnpm guards` で流れる)。外向きの操作だけを拾い、中身は書かない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, lines } from "./record-outbound.mjs";

const bash = (command) => classify("Bash", { command });

test("push・PR・コメント・書き込みの gh api・publish・curl を拾う", () => {
  assert.deepEqual(bash("git push -u origin feat/x"), [
    { means: "git push", target: "origin feat/x" },
  ]);
  assert.deepEqual(bash("git push"), [{ means: "git push", target: "(既定の宛先)" }]);
  assert.deepEqual(bash("gh pr create --draft --title x"), [
    { means: "gh pr create", target: "このリポジトリ" },
  ]);
  assert.deepEqual(bash("gh issue comment 3 --repo other/repo --body hi"), [
    { means: "gh issue comment", target: "other/repo" },
  ]);
  assert.deepEqual(bash("gh api repos/a/b/issues -f title=x"), [
    { means: "gh api(書き込み)", target: "repos/a/b/issues" },
  ]);
  assert.deepEqual(bash("pnpm publish"), [{ means: "pnpm publish", target: "パッケージの置き場" }]);
  assert.deepEqual(bash('curl -s -X POST "https://example.com/form?q=1"'), [
    { means: "curl", target: "example.com" },
  ]);
});

test("つないだコマンドは1つずつ見る", () => {
  assert.deepEqual(
    bash("pnpm lint && git push origin feat/x; gh pr comment 1 --body ok").map((x) => x.means),
    ["git push", "gh pr comment"],
  );
});

test("読むだけの操作は拾わない", () => {
  for (const c of [
    "git status",
    "git log --oneline",
    "gh pr view 1",
    "gh pr checks 1",
    "gh api repos/a/b/pulls",
    "pnpm test",
    "cat README.md",
  ]) {
    assert.deepEqual(bash(c), [], c);
  }
});

test("WebFetch は宛先のホストだけ・WebSearch は言葉を書かない・MCP はサーバーと道具", () => {
  assert.deepEqual(classify("WebFetch", { url: "https://docs.example.com/a?secret=1" }), [
    { means: "WebFetch", target: "docs.example.com" },
  ]);
  assert.deepEqual(classify("WebSearch", { query: "顧客の名前" }), [
    { means: "WebSearch", target: "検索" },
  ]);
  assert.deepEqual(classify("mcp__mail__send", { to: "a@example.com", body: "x" }), [
    { means: "MCP", target: "mail の send" },
  ]);
  assert.deepEqual(classify("Read", { file_path: "x" }), []);
});

test("記録の行に中身(本文・宛先のメールアドレス・問い合わせ)は入らない", () => {
  const out = lines(
    { tool_name: "mcp__mail__send", tool_input: { to: "a@example.com", body: "secret" } },
    new Date("2026-10-25T00:00:00Z"),
  );
  assert.equal(out.length, 1);
  assert.deepEqual(JSON.parse(out[0]), {
    at: "2026-10-25T00:00:00.000Z",
    tool: "mcp__mail__send",
    means: "MCP",
    target: "mail の send",
  });
  assert.doesNotMatch(out[0], /secret|a@example\.com/);
});
