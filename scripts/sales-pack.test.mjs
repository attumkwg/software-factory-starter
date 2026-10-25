// 稟議の資料の束(scripts/sales-pack.mjs)のテスト。node --test scripts/sales-pack.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { blanksOf, flattenLinks, makePack, PACK, sectionOf } from "./sales-pack.mjs";

test("節だけを取り出す・キットの中へのリンクは文だけ・外の URL は残す", () => {
  const text = "# 型\n## 1. あ\n- 1\n## 2. い\n- 2\n### 2.1 う\n- 3\n## 3. え\n- 4";
  assert.equal(sectionOf(text, "## 2."), "## 2. い\n- 2\n### 2.1 う\n- 3");
  assert.equal(sectionOf(text, "## 9."), text);
  assert.equal(
    flattenLinks("[SLA](sla.md) と [規約](../guides/a.md#x) と [AWS](https://aws.amazon.com/)"),
    "SLA と 規約 と [AWS](https://aws.amazon.com/)",
  );
});

test("出す前に埋める所: <…>・YYYY・◯・仮の既定。コードの中(`…`)は数えない", () => {
  assert.deepEqual(
    blanksOf(
      "SLA",
      "稼働率 <99.5%>\n期限 `YYYY-MM-DD`\n日付 YYYY-MM-DD\n期間 1年(仮の既定)\n```\n--start <日>\n```\nふつうの行",
    ),
    [
      "SLA の 1行目: 稼働率 <99.5%>",
      "SLA の 3行目: 日付 YYYY-MM-DD",
      "SLA の 4行目: 期間 1年(仮の既定)",
    ],
  );
});

test("束: 型を順にまとめ、埋める所の数を頭に・無いファイルは無いと書く・注は落とす", () => {
  const files = {
    "docs/legal/README.md": "# 型\n## 1. 一覧\n- x\n## 2. 事実\n| a | <決める> |\n## 3. 次\n- y",
    "docs/legal/sla.md": "# SLA\n<!-- 注 -->\n稼働率 99.5%\n[根拠](../x.md)",
    "docs/legal/data-processing.md": "# 取り扱い\n期間 YYYY",
  };
  const pack = makePack({ read: (f) => files[f], today: "2026-10-25", commit: "abc1234" });
  assert.match(pack, /^# 稟議の資料\(2026-10-25 に作った・キット abc1234\)/);
  assert.match(pack, /## 出す前に埋める所\(2件\)/);
  assert.match(pack, /## 1\. 仕組みの事実[\s\S]*## 2\. 事実/);
  assert.equal(pack.includes("## 3. 次"), false);
  assert.equal(pack.includes("注 -->"), false);
  assert.match(pack, /稼働率 99\.5%\n根拠/);
  assert.match(pack, /\(docs\/compliance\/vendors\.md が無い\)/);
});

test("いまのキットの型で作れる(全部のファイルがある)", () => {
  const read = (f) => readFileSync(f, "utf8");
  for (const p of PACK) assert.ok(read(p.file).length > 0, p.file);
  const pack = makePack({ read, today: "2026-10-25", commit: null });
  assert.match(pack, /## 4\. 委託先の一覧/);
});
