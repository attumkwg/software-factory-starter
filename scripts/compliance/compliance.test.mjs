// 認証の準備(docs/compliance/)の読み方・確かめ方・SoA の作り方のテスト。node --test scripts/compliance/compliance.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FILE as LEDGER_FILE, loadLedger } from "../checkup/todo.mjs";
import { EVIDENCE_NAMES } from "../evidence/sources.mjs";
import {
  CONTROLS_FILE,
  checkLinks,
  loadControls,
  loadPolicies,
  notAdoptedPolicies,
  POLICIES_DIR,
  parseFrontmatter,
  reviewDuePolicies,
  validateControls,
  validateLedgerRefs,
  validatePolicies,
} from "./lib.mjs";
import { renderSoa } from "./soa.mjs";

const catalog = loadControls(readFileSync(CONTROLS_FILE, "utf8"));
const policyFiles = readdirSync(POLICIES_DIR)
  .map((f) => `${POLICIES_DIR}/${f}`)
  .map((file) => ({ file, text: readFileSync(file, "utf8") }));
const policies = loadPolicies(policyFiles);
const exists = (p) => existsSync(p);
const ids = new Set(catalog.controls.map((c) => c.id));

test("管理策の一覧は附属書 A の93件で、書き方と根拠のファイルに問題が無い", () => {
  assert.equal(catalog.controls.length, 93);
  assert.deepEqual(validateControls(catalog, exists), []);
});

test("管理策の一覧の問題を見つける(件数・重なり・理由・実施・根拠のリンク切れ)", () => {
  const broken = {
    controls: [
      { id: "A.5.1", name: "n", applies: true, why: "w", refs: ["nope.md"] },
      { id: "A.5.1", name: "n", applies: "yes" },
      { id: "B.1", name: "n", applies: false, why: "w" },
    ],
  };
  const text = validateControls(broken, () => false).join("\n");
  for (const want of ["how", "2回", "true か false", "why", "番号の形", "nope.md", "37件のはず"])
    assert.ok(text.includes(want), want);
});

test("規程のひな形は6つあり、頭の YAML が正しく、どれもまだ自社の物になっていない(ひな形)", () => {
  assert.equal(policies.length, 6);
  assert.deepEqual(validatePolicies(policies, ids), []);
  assert.equal(notAdoptedPolicies(policies).length, 6);
  assert.deepEqual(reviewDuePolicies(policies, "2099-01-01"), []);
});

test("規程の頭の YAML の問題を見つける", () => {
  const bad = loadPolicies([
    { file: "p/a.md", text: "本文だけ" },
    { file: "p/b.md", text: "---\ntitle: t\ncontrols: [A.9.9]\nestablished: 2026-10-01\n---\n" },
    { file: "p/README.md", text: "一覧" },
  ]);
  const text = validatePolicies(bad, ids).join("\n");
  for (const want of ["頭の YAML", "version", "owner", "A.9.9", "next_review"])
    assert.ok(text.includes(want), want);
  assert.equal(bad.length, 2, "README は規程として読まない");
});

test("頭の YAML を読む(無ければ meta は null)", () => {
  assert.deepEqual(parseFrontmatter("---\na: 1\n---\n本文").meta, { a: 1 });
  assert.equal(parseFrontmatter("本文").meta, null);
});

test("台帳と管理策の一覧が指す管理策・証跡が実在する", () => {
  const ledger = loadLedger(readFileSync(LEDGER_FILE, "utf8"));
  assert.deepEqual(validateLedgerRefs(ledger, ids, EVIDENCE_NAMES, catalog), []);
  const bad = { items: [{ id: "x", controls: ["A.5.99"], evidence: ["nope"] }] };
  const text = validateLedgerRefs(bad, ids, EVIDENCE_NAMES, { controls: [] }).join("\n");
  assert.match(text, /A\.5\.99/);
  assert.match(text, /nope/);
});

test("相対リンクの切れを見つける(外の URL・ページの中の # は見ない)", () => {
  const files = [
    {
      file: "docs/compliance/a.md",
      text: "[ok](b.md) [up](../x.md#節) [web](https://example.com) [here](#節) [ng](nope.md)",
    },
  ];
  const ok = new Set(["docs/compliance/b.md", "docs/x.md"]);
  assert.deepEqual(
    checkLinks(files, (p) => ok.has(p)),
    ["docs/compliance/a.md のリンク nope.md の先が無い(リンク切れ)"],
  );
});

test("SoA: 主題ごとの表に、点検の項目・証跡・規程が並ぶ(引退した項目は出さない)", () => {
  const cat = {
    standard: "S",
    controls: [
      { id: "A.5.1", name: "方針", applies: true, why: "w", how: "h", refs: ["docs/security.md"] },
      { id: "A.7.1", name: "境界", applies: false, why: "事務所なし" },
    ],
  };
  const ledger = {
    items: [
      { id: "keep", controls: ["A.5.1"], evidence: ["drills"] },
      { id: "old", status: "retired", controls: ["A.5.1"] },
    ],
  };
  const pol = [{ file: "docs/compliance/policies/p.md", meta: { controls: ["A.5.1"] } }];
  const soa = renderSoa({ catalog: cat, ledger, policies: pol });
  assert.match(soa, /適用 1件・除外 1件/);
  assert.match(
    soa,
    /\| A\.5\.1 \| 方針 \| 適用 \| w \| h \| `keep` \| `drills` \| \[p\.md\]\(policies\/p\.md\) \[security\.md\]\(\.\.\/security\.md\) \|/,
  );
  assert.match(soa, /\| A\.7\.1 \| 境界 \| 除外 \| 事務所なし \| — \|/);
  assert.doesNotMatch(soa, /`old`/);
});

test("pnpm compliance が通る(SoA は最新・リンク切れなし)", () => {
  const out = execFileSync("node", [join("scripts", "compliance", "run.mjs")], {
    encoding: "utf8",
  });
  assert.match(out, /SoA は最新/);
});
