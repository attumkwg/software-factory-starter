// 委託先の台帳から、人が読む一覧(docs/compliance/vendors.md)を作る。入口は vendors.mjs(--write)。
// 手で書かない。生成し忘れは `pnpm vendors`(CI)が落とす。

const cell = (v) =>
  String(v ?? "")
    .replaceAll("|", "/")
    .replaceAll("\n", " ");
const list = (xs) => (Array.isArray(xs) && xs.length > 0 ? xs.join("・") : "なし");
const code = (xs) => xs.map((x) => `\`${x}\``).join("・");

const vendorRow = (v) =>
  `| ${cell(v.name)} | ${cell(v.relation)}${v.ai ? "(AI)" : ""} | ${cell(v.country)} | ${list(v.data)} | ${cell(v.contract?.dpa)} | ${list(v.certifications)} |`;

const detail = (v, usage) => {
  const lines = [
    `### ${v.name}`,
    "",
    `- 何に使うか: ${v.what}`,
    `- 預け方: ${v.relation}${v.ai ? "(AI の会社。personal・sensitive は渡さない)" : ""}`,
    `- 置き場所: ${v.country}`,
    `- 渡す区分: ${list(v.data)}`,
    `- 契約(DPA): ${v.contract?.dpa}(${v.contract?.link})${v.contract?.note ? `。${v.contract.note}` : ""}`,
    `- 第三者の認証: ${list(v.certifications)}${v.certifications_link ? `(${v.certifications_link})` : ""}`,
    `- 使うのをやめたとき: ${v.deletion?.when_we_leave}`,
    `- お客さんが解約したとき: ${v.deletion?.when_tenant_leaves}`,
    `- 公開の約款と認証を確かめた日: ${v.checked_on}`,
  ];
  if (v.status === "ended") lines.push(`- 使うのをやめた日: ${v.ended_on}`);
  const used = usage[v.id];
  if (used?.packages.length) lines.push(`- コードで使っている SDK: ${code(used.packages)}`);
  if (used?.actions.length) lines.push(`- ワークフローで使っている Actions: ${code(used.actions)}`);
  return lines.join("\n");
};

const servicesTable = (v) => [
  `### ${v.name} のサービスごとの区分`,
  "",
  "| サービス | 渡す区分 | Terraform の資源の種類 | 補足 |",
  "|---|---|---|---|",
  ...v.services.map(
    (s) => `| ${cell(s.name)} | ${list(s.data)} | ${code(s.terraform ?? [])} | ${cell(s.note)} |`,
  ),
];

/** vendors.md の全文 */
export const renderVendors = (ledger, usage) => {
  const vendors = ledger.vendors ?? [];
  const activeOnes = vendors.filter((v) => v.status === "active");
  const ended = vendors.filter((v) => v.status === "ended");
  const out = [
    "# 委託先の一覧",
    "",
    "> **生成物。手で直さない。** 正は [vendors.yaml](vendors.yaml)。直したら `pnpm vendors --write`(作り忘れは CI が落とす)。",
    "> 決まりは [設計書 0017](../designs/0017-vendors-ai-data-audit-trail.md)・AI に渡してよいデータは [ai-data.md](ai-data.md)。",
    "> 契約の欄は「公開の約款を確かめた」まで。使う人は自分の契約(プラン・置き場所・保存の日数)を確かめて vendors.yaml を書き直す。",
    "",
    "## 使っている会社",
    "",
    "| 会社 | 預け方 | 置き場所 | 渡す区分 | 契約(DPA) | 第三者の認証 |",
    "|---|---|---|---|---|---|",
    ...activeOnes.map(vendorRow),
    "",
    "区分は `apps/api/src/db/classification.ts` と同じ: public(選択肢・真偽)/ internal(ID・時刻・回数)/ personal(個人情報・自由な文)/ sensitive(要配慮)。",
    "",
    "## 会社ごと",
    "",
    ...activeOnes.flatMap((v) => [detail(v, usage), ""]),
    ...activeOnes
      .filter((v) => (v.services ?? []).length > 0)
      .flatMap((v) => [...servicesTable(v), ""]),
  ];
  if (ended.length > 0) {
    out.push("## 使うのをやめた会社", "", ...ended.flatMap((v) => [detail(v, usage), ""]));
  }
  return `${out.join("\n").trimEnd()}\n`;
};
