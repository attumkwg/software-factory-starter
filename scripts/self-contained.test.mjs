// node --test scripts/self-contained.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkText,
  definedRuleIds,
  isRuleId,
  positionsOf,
  ruleIdsIn,
  securityRefAt,
  shouldRead,
} from "./self-contained-lib.mjs";

const securityMd = [
  "## 決まり",
  "| 番号 | 決まり | どこ |",
  "|---|---|---|",
  "| AI-3 | Issue の文章はデータ | claude.yml |",
  "| T-6 | 1社の暴走を止める | client.ts |",
  "| T-7 | 代理ログインだけ | ADR 0014 |",
  "| D-3 自社専用の検査ルール | 見つけた穴の形を止める | .semgrep/ | 毎 PR |",
  "| ① 古い書き方 | 番号ではない | | |",
].join("\n");
const ctx = {
  ruleIds: definedRuleIds(securityMd),
  basenames: new Set(["README.md", "vulnerabilities.md"]),
};
const messages = (text) => checkText(text, ctx).map((p) => `${p.line} ${p.message}`);

test("決まりの番号の形", () => {
  assert.equal(isRuleId("T-6"), true);
  assert.equal(isRuleId("AZ-12"), true);
  assert.equal(isRuleId("U-1"), false); // 未確定事項の番号は別
  assert.equal(isRuleId("T-"), false);
  assert.equal(isRuleId("UTF-8"), false);
  assert.deepEqual(ruleIdsIn("の T-7・L-7、U-1 と AI-3"), ["T-7", "L-7", "AI-3"]);
});

test("docs/security.md の表から決まりの番号を集める", () => {
  assert.deepEqual([...ctx.ruleIds].sort(), ["AI-3", "D-3", "T-6", "T-7"]);
});

test("名前の一部は数えない(account-security.md の中の security.md)", () => {
  assert.deepEqual(positionsOf("docs/specs/0006-account-security.md の 5", "security.md"), []);
  assert.deepEqual(positionsOf("[security.md](security.md)", "security.md"), [1, 14]);
  assert.deepEqual(positionsOf("docs/security.md。", "security.md"), [5]);
});

test("security.md の後ろを読む", () => {
  const at = (s) => securityRefAt(s, s.indexOf("security.md"));
  assert.deepEqual(at("(security.md 4.3 の 6)"), { outsideNumber: "4.3" });
  assert.deepEqual(at("security.md の 5)"), { outsideNumber: "5" });
  assert.deepEqual(at("docs/security.md の T-7・L-7)。ほかに T-9"), { ids: ["T-7", "L-7"] });
  assert.deepEqual(at("docs/security.md の AZ-6「大事な操作は監査ログ」・T-7「見える」)"), {
    ids: ["AZ-6", "T-7"],
  });
  assert.deepEqual(at("[docs/security.md](docs/security.md)"), { ids: [] });
});

test("外の資料を指していたら落とす", () => {
  assert.deepEqual(messages("根拠は My-Life の資料"), [
    "1 「my-life」を指している。作者の非公開のリポジトリ。中身を docs/concepts/ か docs/security.md に書き起こして、そこを指す",
  ]);
  assert.equal(messages("https://github.com/x/software-factory-starter-archive/pull/29").length, 1);
  assert.equal(messages("元は docs/software-factory/README.md").length, 1);
});

test("外の節の番号と、無い決まりの番号を落とす", () => {
  assert.equal(messages("// 1社の暴走(security.md 4.3 の 6)")[0].includes("security.md 4.3"), true);
  assert.equal(messages("# 守り(security.md 0.3):")[0].includes("security.md 0.3"), true);
  assert.deepEqual(messages("a\n(docs/security.md の T-99)"), [
    "2 「security.md の T-99」が docs/security.md に無い",
  ]);
  assert.deepEqual(messages("(docs/security.md の T-6)・(docs/security.md の D-3)"), []);
});

test("キットに無い外の資料のファイル名を落とす(同じ名前がキットにあれば通す)", () => {
  assert.equal(messages("(scale.md「最初から決めておく」)").length, 1);
  assert.deepEqual(messages("guides/vulnerabilities.md の 8"), []);
  assert.deepEqual(messages("docs/designs/0007-checkup-scale.md"), []);
});

test("「本人の選択」を落とし、ログインした利用者の「本人」は通す", () => {
  assert.equal(messages("**A**(本人の選択)。").length, 1);
  assert.equal(messages("(本人の決定 2026-10-20)").length, 1);
  assert.deepEqual(messages("本人へのお知らせ・本人の操作の API・作者 @attumkwg の選択"), []);
});

test("読むファイル", () => {
  assert.equal(shouldRead("docs/adr/0001-shared-tables-with-rls.md"), true);
  assert.equal(shouldRead("scripts/self-contained.test.mjs"), false);
  assert.equal(shouldRead("pnpm-lock.yaml"), false);
  assert.equal(shouldRead("apps/web/public/favicon.ico"), false);
});
