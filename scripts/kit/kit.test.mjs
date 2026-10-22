// 部品のカタログの検査と README の生成のテスト(node --test。pnpm kit:catalog が流す)
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRemovedSet, readDecisions, validateCatalog } from "./catalog-lib.mjs";
import { END, renderSection, replaceSection, START } from "./readme-lib.mjs";

const part = (over = {}) => ({
  id: "audit-log",
  name: "監査ログ",
  group: "business",
  status: "あり",
  removable: true,
  default: "残す",
  what: "誰が・いつ・何を",
  needed_by: "会社向け",
  not_needed_by: "個人向け",
  if_removed: "記録が無くなる",
  depends_on: [],
  law: [],
  remove: { delete: ["apps/api/src/audit"] },
  ...over,
});

const catalogOf = (parts) => ({
  version: 1,
  start_steps: [{ title: "部品を選ぶ", does: "残す・消す", status: "あり", command: "/tailor" }],
  questions: [
    {
      id: "audience",
      text: "会社向けか",
      kind: "戻せないリスク",
      options: ["会社向け", "個人向け"],
      recommended: "会社向け",
      why: "後から変えるのが高い",
    },
  ],
  groups: [
    { id: "foundation", name: "土台" },
    { id: "business", name: "会社向け" },
  ],
  parts,
});

const files = {
  "apps/api/src/audit": "",
  "docs/authz/matrix.yaml": "routes:\n  - route: GET /api/audit-events\n",
  "infra/terraform/envs/stg/main.tf": 'module "waf" {\n}\n',
  ".github/workflows/ci.yml": "jobs:\n  e2e:\n    runs-on: x\n",
};
const fsx = { exists: (p) => p in files, read: (p) => files[p] ?? "" };

test("正しいカタログは問題なし", () => {
  assert.deepEqual(validateCatalog(catalogOf([part()]), fsx), []);
});

test("消し方のパスが無ければ落とす(「あり」だけ)", () => {
  const p = part({ remove: { delete: ["apps/api/src/nothing"] } });
  assert.match(validateCatalog(catalogOf([p]), fsx).join(), /apps\/api\/src\/nothing が無い/);
  const wip = part({ status: "作成中", remove: { delete: ["apps/api/src/nothing"] } });
  assert.deepEqual(validateCatalog(catalogOf([wip]), fsx), []);
});

test("権限の表の行・Terraform のモジュール・CI のジョブが無ければ落とす", () => {
  const p = part({
    remove: {
      matrix: ["GET /api/nothing"],
      terraform: [{ file: "infra/terraform/envs/stg/main.tf", module: "uptime" }],
      ci: [{ file: ".github/workflows/ci.yml", job: "image" }],
    },
  });
  const problems = validateCatalog(catalogOf([p]), fsx).join("\n");
  assert.match(problems, /GET \/api\/nothing/);
  assert.match(problems, /module "uptime"/);
  assert.match(problems, /ジョブ image/);
});

test("「あり」で消せる部品に消し方が無ければ落とす", () => {
  const p = part({ remove: undefined });
  assert.match(validateCatalog(catalogOf([p]), fsx).join(), /消し方/);
});

test("つながりの相手がカタログに無ければ落とす", () => {
  const p = part({ depends_on: ["nothing"] });
  assert.match(validateCatalog(catalogOf([p]), fsx).join(), /nothing がカタログに無い/);
});

test("土台は既定が「消す」・消し方つき・消した、のどれも落とす", () => {
  const base = { group: "foundation", removable: false, remove: undefined };
  const bad = [
    part({ ...base, id: "a", default: "消す" }),
    part({ ...base, id: "b", remove: { delete: ["apps/api/src/audit"] } }),
    part({ ...base, id: "c", status: "消した" }),
  ];
  const problems = validateCatalog(catalogOf(bad), fsx).join("\n");
  assert.match(problems, /土台 a の default/);
  assert.match(problems, /土台 b に消し方/);
  assert.match(problems, /土台 c は消せない/);
});

test("消すおすすめの条件は、質問と選択肢が実在すること", () => {
  const p = part({ suggest_remove_when: ["audience=個人", "nothing=x"] });
  const problems = validateCatalog(catalogOf([p]), fsx).join("\n");
  assert.match(problems, /答え 個人 が選択肢に無い/);
  assert.match(problems, /質問 nothing が無い/);
});

test("消す部品に、残す部品が頼っていたら落とす。土台を消す答えも落とす", () => {
  const parts = [
    part({ id: "base", removable: false, remove: undefined }),
    part({ id: "audit-log" }),
    part({ id: "support", depends_on: ["audit-log"] }),
    part({ id: "later", status: "未", depends_on: ["audit-log"] }),
  ];
  const problems = checkRemovedSet(parts, new Set(["audit-log", "base"]));
  assert.deepEqual(problems, [
    "土台 base を消す答えになっている",
    "audit-log を消すと、残す support が困る(support が頼っている)",
  ]);
  assert.deepEqual(checkRemovedSet(parts, new Set(["audit-log", "support"])), []);
});

test("記録の表から、部品ごとの最新の決定を読む", () => {
  const text = [
    "## 2026-10-22",
    "| id | 部品 | 決定 | 理由 |",
    "|---|---|---|---|",
    "| audit-log | 監査ログ | 残す | 会社向け |",
    "| nothing | 無い | 消す | — |",
    "## 2026-12-01",
    "| audit-log | 監査ログ | 消す | 個人向けに変えた |",
  ].join("\n");
  const { decisions, problems } = readDecisions(text, new Set(["audit-log"]));
  assert.equal(decisions.get("audit-log"), "消す");
  assert.deepEqual(problems, ["記録の部品 nothing がカタログに無い"]);
});

test("README は印の間だけを書き換える", () => {
  const section = renderSection(
    catalogOf([part(), part({ id: "base", group: "foundation", removable: false })]),
  );
  assert.match(section, /🔒 監査ログ `base`/);
  assert.match(section, /`\/tailor`: 残す・消す/);
  const readme = `# 前\n${START}\n古い\n${END}\n## 後\n`;
  const out = replaceSection(readme, section);
  assert.ok(out.startsWith(`# 前\n${START}\n## 🧰`));
  assert.ok(out.endsWith(`${END}\n## 後\n`));
  assert.equal(replaceSection(out, section), out);
  assert.throws(() => replaceSection("# 印なし", section), /印/);
});
