// 依存のライセンスの一覧を書く。人が読む一覧(docs/compliance/licenses.md)と、DD・審査に渡す版つきの全部(CSV)。
// 入口は licenses.mjs(--write・--full)。
import { classify, classOf } from "./licenses-lib.mjs";

const HEADER = [
  "# 依存のライセンスの一覧",
  "",
  "> **生成物。手で直さない。** 正は [licenses.yaml](licenses.yaml)(決まり)と `pnpm-lock.yaml`(依存)。依存を足したら `pnpm deps:licenses --write`(作り忘れ・入れないライセンス・決まりに無いライセンスは CI が落とす)。",
  "> 版の番号は書かない(Renovate が版を上げるたびに変わらないように)。版つきの全部の一覧(DD・審査・弁護士に渡す)は `pnpm deps:licenses --full <ファイル>.csv`。",
  "> OS・CPU ごとの本体(`@esbuild/linux-x64` など)は除いた。手元と CI で入る物が違うため(中身は親と同じ作り手の物)。",
  "> キット自身のライセンスは [MIT](../../LICENSE)。決まりの理由は [ADR 0083](../adr/0083-dependency-licenses.md)。キットから作ったプロダクトでは、売る前に専門家に確かめる([getting-started.md](../getting-started.md) の ②)。",
];

const cell = (s) => String(s).replaceAll("|", "\\|");
const table = (head, rows) => [
  `| ${head.join(" | ")} |`,
  `|${head.map(() => "---").join("|")}|`,
  ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
];

/** ライセンスの式を分け方ごとに(種類だけ。数は依存の入れ替えで揺れるので書かない) */
const kindsByClass = (packages, policy) => {
  const out = { 許す: new Set(), 注意: new Set(), 知らない: new Set(), 入れない: new Set() };
  for (const p of packages) for (const l of p.licenses) out[classify(l, policy)].add(l);
  return out;
};

/**
 * 人が読む一覧。packages は名前ごと(byName)、prod は本番に入る名前の Set、direct は directDeps の結果
 */
export const renderLicenses = ({ packages, prod, direct, policy }) => {
  const kinds = kindsByClass(packages, policy);
  const list = (set) => ([...set].sort().join("・") || "なし").replaceAll("|", "\\|");
  const licenseOf = new Map(packages.map((p) => [p.name, p.licenses.join(" / ")]));
  const reviewed = (policy.review ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...HEADER,
    "",
    "## 1. まとめ(出てくるライセンスの種類)",
    "",
    ...table(
      ["分け方", "意味", "出てくる種類"],
      [
        ["✅ 許す", "表示を残せば、使う・配る・売るに制限が無い", list(kinds.許す)],
        ["🟡 注意", "使ってよいが、条件がある。下の 2 に1件ずつ", list(kinds.注意)],
        ["❓ 決まりに無い", "下の 2 に1件ずつ確かめた", list(kinds.知らない)],
        ["⛔ 入れない", "MIT のキットと合わない(GPL・AGPL など)", list(kinds.入れない)],
      ],
    ),
    "",
    "## 2. 注意の物(1件ずつ、なぜ使ってよいか)",
    "",
    ...table(
      ["パッケージ", "ライセンス", "入る所", "なぜ使ってよいか"],
      reviewed.map((r) => [
        `\`${r.name}\``,
        licenseOf.get(r.name) ?? r.license,
        prod.has(r.name) ? "本番" : "開発",
        r.why ?? "",
      ]),
    ),
    "",
    "## 3. 直接の依存(自分たちの package.json)",
    "",
    "> 本番 = どれかの package.json の `dependencies` にある。開発 = `devDependencies` だけ。",
    "",
    ...table(
      ["パッケージ", "ライセンス", "入る所", "使う所"],
      direct.map((d) => [
        `\`${d.name}\``,
        licenseOf.get(d.name) ?? "(入っていない)",
        d.kind,
        d.where,
      ]),
    ),
    "",
  ].join("\n");
};

const csvCell = (s) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

/** DD・審査に渡す、版つきの全部(1行 = 名前と版)。packages は packagesFrom の結果(OS ごとの本体も含む) */
export const renderFullCsv = ({ packages, prod, policy }) => {
  const rows = packages
    .flatMap((p) => p.versions.map((v) => ({ ...p, version: v })))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return [
    ["name", "version", "license", "class", "scope", "homepage"].join(","),
    ...rows.map((p) =>
      [
        p.name,
        p.version,
        p.license,
        classOf({ licenses: [p.license] }, policy),
        prod.has(p.name) ? "本番" : "開発",
        p.homepage,
      ]
        .map((s) => csvCell(String(s)))
        .join(","),
    ),
    "",
  ].join("\n");
};
