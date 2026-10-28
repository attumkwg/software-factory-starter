// node --test scripts/licenses.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  byName,
  checkPolicy,
  classify,
  directDeps,
  packagesFrom,
  withoutPlatformBinaries,
} from "./licenses-lib.mjs";
import { renderFullCsv, renderLicenses } from "./licenses-render.mjs";

const policy = {
  allow: ["MIT", "Apache-2.0", "ISC"],
  caution: ["MPL-*", "FSL-*"],
  deny: ["GPL-*", "AGPL-*"],
  review: [{ name: "lightningcss", license: "MPL-2.0", why: "build の道具" }],
};
const pkg = (name, license, extra = {}) => ({
  name,
  licenses: [license],
  versions: ["1.0.0"],
  ...extra,
});

test("名前を分ける(* は何文字でも。LGPL は GPL-* に当たらない)", () => {
  assert.equal(classify("MIT", policy), "許す");
  assert.equal(classify("MPL-2.0", policy), "注意");
  assert.equal(classify("GPL-3.0-only", policy), "入れない");
  assert.equal(classify("AGPL-3.0", policy), "入れない");
  assert.equal(classify("LGPL-2.1", policy), "知らない");
  assert.equal(classify("WTFPL", policy), "知らない");
});

test("OR はどれかを選べる(良い方)、AND は全部に従う(悪い方)", () => {
  assert.equal(classify("MIT OR Apache-2.0", policy), "許す");
  assert.equal(classify("(GPL-2.0 OR MIT)", policy), "許す");
  assert.equal(classify("MIT AND MPL-2.0", policy), "注意");
  assert.equal(classify("(MIT AND GPL-3.0)", policy), "入れない");
});

test("入れないライセンスは落ちる", () => {
  const problems = checkPolicy([pkg("a", "MIT"), pkg("bad", "GPL-3.0")], { ...policy, review: [] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /bad.*入れない/);
});

test("注意・決まりに無いライセンスは、review に無ければ落ち、あれば通る", () => {
  const packages = [pkg("lightningcss", "MPL-2.0"), pkg("x", "WTFPL")];
  const problems = checkPolicy(packages, policy);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /x.*決まりに無い/);
  const ok = checkPolicy(packages, {
    ...policy,
    review: [...policy.review, { name: "x", license: "WTFPL", why: "試し" }],
  });
  assert.deepEqual(ok, []);
});

test("review の古さ(もう無い・ライセンスが変わった・why が無い)", () => {
  const review = [
    { name: "gone", license: "MIT", why: "前は使っていた" },
    { name: "changed", license: "MPL-2.0", why: "前は MPL" },
    { name: "nowhy", license: "MPL-2.0" },
  ];
  const problems = checkPolicy([pkg("changed", "FSL-1.1-Apache-2.0"), pkg("nowhy", "MPL-2.0")], {
    ...policy,
    review,
  });
  assert.equal(problems.length, 3);
  assert.match(problems[0], /gone.*もう依存に無い/);
  assert.match(problems[1], /changed.*今は FSL/);
  assert.match(problems[2], /nowhy.*why/);
});

test("pnpm licenses の JSON を1件ずつに・OS ごとの本体を除く・名前ごとにまとめる", () => {
  const json = {
    MIT: [
      { name: "esbuild", versions: ["0.1.0"], paths: ["/m/esbuild"], license: "MIT" },
      { name: "@esbuild/linux-x64", versions: ["0.1.0"], paths: ["/m/linux"], license: "MIT" },
    ],
    "Apache-2.0": [
      { name: "esbuild", versions: ["0.2.0"], paths: ["/m/esbuild2"], license: "Apache-2.0" },
    ],
  };
  const all = packagesFrom(json);
  assert.equal(all.length, 3);
  const manifests = { "/m/linux": { os: ["linux"], cpu: ["x64"] } };
  const kept = withoutPlatformBinaries(all, (p) => manifests[p] ?? {});
  assert.deepEqual(
    kept.map((p) => p.name),
    ["esbuild", "esbuild"],
  );
  const named = byName(kept);
  assert.equal(named.length, 1);
  assert.deepEqual(named[0].versions, ["0.1.0", "0.2.0"]);
  assert.deepEqual(named[0].licenses, ["MIT", "Apache-2.0"]);
});

test("直接の依存: 本番が勝つ・workspace: は除く・使う所を並べる", () => {
  const direct = directDeps([
    { path: "package.json", json: { devDependencies: { turbo: "1", hono: "1" } } },
    {
      path: "apps/api/package.json",
      json: { dependencies: { hono: "1", "@app/shared": "workspace:*" } },
    },
  ]);
  assert.deepEqual(direct, [
    { name: "hono", kind: "本番", where: "(ルート)・apps/api" },
    { name: "turbo", kind: "開発", where: "(ルート)" },
  ]);
});

test("一覧は版を書かず、注意の物と直接の依存を並べる。CSV は版つき", () => {
  const packages = [pkg("hono", "MIT"), pkg("lightningcss", "MPL-2.0")];
  const md = renderLicenses({
    packages,
    prod: new Set(["hono"]),
    direct: [{ name: "hono", kind: "本番", where: "apps/api" }],
    policy,
  });
  assert.match(md, /\| `lightningcss` \| MPL-2\.0 \| 開発 \| build の道具 \|/);
  assert.match(md, /\| `hono` \| MIT \| 本番 \| apps\/api \|/);
  assert.doesNotMatch(md, /1\.0\.0/);
  const csv = renderFullCsv({
    packages: [{ name: "a", versions: ["1.0.0", "2.0.0"], license: "MIT", homepage: "x,y" }],
    prod: new Set(),
    policy,
  });
  assert.deepEqual(csv.trim().split("\n").slice(1), [
    'a,1.0.0,MIT,許す,開発,"x,y"',
    'a,2.0.0,MIT,許す,開発,"x,y"',
  ]);
});
