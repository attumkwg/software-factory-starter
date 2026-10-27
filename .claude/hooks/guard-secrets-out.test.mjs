// guard-secrets-out.mjs のテスト(`pnpm guards` で流れる)。外へ書く文章の秘密の形だけを止める。
import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyFiles, decide, secretsIn } from "./guard-secrets-out.mjs";

// テスト用の偽の値(本物の鍵ではない。形だけ合わせる)
const FAKE_ANTHROPIC = `sk-ant-api03-${"a".repeat(40)}`;
const FAKE_GH = `ghs_${"B".repeat(36)}`;
const FAKE_AWS = `AKIA${"C".repeat(16)}`;
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const noFiles = () => {
  throw new Error("no file");
};

test("形の分かる鍵を見つける(名前だけ返し、値は返さない)", () => {
  assert.deepEqual(secretsIn(`key=${FAKE_ANTHROPIC}`), ["Anthropic の API キー"]);
  assert.deepEqual(secretsIn(`t ${FAKE_GH} a ${FAKE_AWS}`), [
    "GitHub のトークン",
    "AWS のアクセスキー",
  ]);
  assert.deepEqual(secretsIn("-----BEGIN OPENSSH PRIVATE KEY-----"), ["秘密鍵"]);
  assert.deepEqual(secretsIn("ふつうのコメント。sk-ant を使う設定の話"), []);
});

test("いまの環境のトークンは、そのままでも base64 でも見つける", () => {
  const live = "x".repeat(40);
  assert.deepEqual(secretsIn(`貼る: ${live}`, [live]), ["いまの GitHub のトークン"]);
  const b64 = Buffer.from(live).toString("base64");
  assert.deepEqual(secretsIn(`貼る: ${b64}`, [live]), ["いまの GitHub のトークン"]);
});

test("外へ書く gh のコマンドに秘密があれば止める", () => {
  const r = decide(bash(`gh issue comment 42 --body "${FAKE_ANTHROPIC}"`), {}, noFiles);
  assert.equal(r.decision, "deny");
  assert.ok(!r.reason.includes(FAKE_ANTHROPIC), "理由に値を出さない");
  assert.equal(
    decide(bash(`gh pr create --title x --body ${FAKE_GH}`), {}, noFiles).decision,
    "deny",
  );
  assert.equal(
    decide(bash(`gh api repos/a/b/issues/1/comments -f body=${FAKE_AWS}`), {}, noFiles).decision,
    "deny",
  );
});

test("本文をファイルから読む書き方も、ファイルの中を見る", () => {
  const read = (f) => (f === "/tmp/body.md" ? `中身 ${FAKE_GH}` : "");
  assert.deepEqual(bodyFiles("gh pr create --body-file /tmp/body.md"), ["/tmp/body.md"]);
  assert.deepEqual(bodyFiles("gh api x -F body=@/tmp/body.md"), ["/tmp/body.md"]);
  assert.deepEqual(bodyFiles("gh api x --input=/tmp/body.md"), ["/tmp/body.md"]);
  assert.equal(decide(bash("gh pr create --body-file /tmp/body.md"), {}, read).decision, "deny");
});

test("MCP の書き込みは引数の全部を見る", () => {
  const input = {
    tool_name: "mcp__github_comment__update_claude_comment",
    tool_input: { body: FAKE_GH },
  };
  assert.equal(decide(input, {}, noFiles).decision, "deny");
});

test("読むだけのコマンド・外へ書かないコマンド・秘密の無い文章は通す", () => {
  assert.equal(decide(bash(`gh issue view 42`), {}, noFiles), null);
  assert.equal(decide(bash(`echo ${FAKE_GH}`), {}, noFiles), null);
  assert.equal(decide(bash(`gh pr comment 3 --body "直しました"`), {}, noFiles), null);
  assert.equal(
    decide({ tool_name: "Read", tool_input: { file_path: FAKE_GH } }, {}, noFiles),
    null,
  );
});
