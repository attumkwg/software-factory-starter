// キットの版の比べ(upstream.mjs)と、点検の kit-upstream のテスト。node --test scripts/checkup/upstream.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { check as kitUpstream } from "./checks/kit-upstream.mjs";
import { err, fakeCtx, ok } from "./fake-context.mjs";
import { compareUpstream, parseVersion, readUpstream, upstreamMessage } from "./upstream.mjs";

test("版の形: vX.Y.Z だけ読む", () => {
  assert.deepEqual(parseVersion("v0.12.3"), [0, 12, 3]);
  assert.equal(parseVersion("0.1.0"), undefined);
  assert.equal(parseVersion("v1.0"), undefined);
  assert.equal(parseVersion(null), undefined);
});

test("比べ: 0. の間は2つ目、1 から後は1つ目の数字が上がると手が要る", () => {
  assert.deepEqual(compareUpstream("v0.2.0", "v0.2.0"), { state: "latest" });
  assert.deepEqual(compareUpstream("v0.3.0", "v0.2.9"), { state: "latest" });
  assert.deepEqual(compareUpstream("v0.2.0", "v0.2.1"), { state: "behind", hands: false });
  assert.deepEqual(compareUpstream("v0.2.5", "v0.3.0"), { state: "behind", hands: true });
  assert.deepEqual(compareUpstream("v0.9.0", "v1.0.0"), { state: "behind", hands: true });
  assert.deepEqual(compareUpstream("v1.2.0", "v1.3.0"), { state: "behind", hands: false });
  assert.deepEqual(compareUpstream("v1.2.0", "v2.0.0"), { state: "behind", hands: true });
  // 記録が無い(版の前に作った)なら、手が要るものとして知らせる
  assert.deepEqual(compareUpstream(undefined, "v0.1.0"), { state: "behind", hands: true });
  assert.deepEqual(compareUpstream("v0.1.0", "latest"), { state: "unknown" });
});

test("記録の読み方と知らせの文", () => {
  assert.equal(readUpstream(undefined), undefined);
  assert.deepEqual(readUpstream("repository: a/b\nversion: null\n"), {
    repository: "a/b",
    version: undefined,
  });
  const text = upstreamMessage({
    repository: "a/b",
    current: "v0.1.0",
    latest: "v0.2.0",
    hands: true,
  });
  assert.match(text, /新しい版 v0\.2\.0.*取り込んだのは v0\.1\.0.*手が要る/);
  assert.match(text, /github\.com\/a\/b\/blob\/main\/CHANGELOG\.md/);
  assert.match(text, /docs\/kit\/upgrade\.md/);
});

const files = (version) => ({
  "docs/kit/upstream.yaml": `repository: kit/x\nversion: ${version}\n`,
});
const release = (tag) => ({ "repos/kit/x/releases/latest": ok({ tag_name: tag }) });

test("kit-upstream: 新しい版が出ていれば不合格・同じなら合格・版が無ければ合格", async () => {
  const behind = await kitUpstream(fakeCtx({ files: files("v0.1.0"), gh: release("v0.2.0") }));
  assert.equal(behind.result, "fail");
  assert.match(behind.note, /v0\.2\.0.*v0\.1\.0/);
  const same = await kitUpstream(fakeCtx({ files: files("v0.2.0"), gh: release("v0.2.0") }));
  assert.equal(same.result, "pass");
  const none = await kitUpstream(
    fakeCtx({ files: files("null"), gh: { "repos/kit/x/releases/latest": err(404) } }),
  );
  assert.equal(none.result, "pass");
  assert.match(none.note, /まだ版/);
  const broken = await kitUpstream(
    fakeCtx({ files: files("v0.1.0"), gh: { "repos/kit/x/releases/latest": err(500) } }),
  );
  assert.equal(broken.result, "unknown");
});

test("kit-upstream: 記録が無ければ setup.yml のキットと比べる・ひな形では比べない", async () => {
  const ctx = fakeCtx({
    files: { ".github/setup.yml": "template_repository: kit/x\n" },
    gh: release("v0.1.0"),
  });
  const r = await kitUpstream(ctx);
  assert.equal(r.result, "fail");
  assert.match(r.note, /記録なし/);
  assert.equal((await kitUpstream({ ...ctx, role: "template" })).result, "pass");
  assert.equal((await kitUpstream(fakeCtx({}))).result, "unknown");
});
