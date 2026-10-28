// 依存のライセンスの一覧の中身(読む・分ける・照らし合わせる・書く)。入口は licenses.mjs、テストは licenses.test.mjs。
// 決まりは docs/compliance/licenses.yaml(正)と ADR 0083。
// 名前の照らし合わせ(* は何文字でも)は委託先の台帳と同じ物を使う(正規表現を組み立てない。Semgrep の regex_dos)。
import { matches } from "./vendors-lib.mjs";

/** pnpm licenses list --json の形({ ライセンス: [{ name, versions, paths, license, homepage }] })を1件ずつに */
export const packagesFrom = (json) =>
  Object.values(json)
    .flat()
    .map((p) => ({
      name: p.name,
      versions: p.versions ?? [],
      paths: p.paths ?? [],
      license: p.license || "Unknown",
      homepage: p.homepage ?? "",
    }));

/**
 * OS・CPU ごとの本体(package.json に os か cpu がある物)を除く。
 * 入る物が手元(Windows・mac)と CI(Linux)で違い、一覧が OS で揺れるため。中身は親(esbuild・biome など)と同じ作り手の物
 */
export const withoutPlatformBinaries = (packages, manifestOf) =>
  packages.filter((p) => !p.paths.some((path) => isPlatformBinary(manifestOf(path))));

const isPlatformBinary = (manifest) => Boolean(manifest && (manifest.os || manifest.cpu));

/** 名前ごとに1件へまとめる(版が違う同じ名前は1つ。ライセンスが版で違えば並べる) */
export const byName = (packages) => {
  const map = new Map();
  for (const p of packages) {
    const prev = map.get(p.name);
    if (!prev) map.set(p.name, { ...p, licenses: [p.license] });
    else {
      prev.versions = [...new Set([...prev.versions, ...p.versions])];
      if (!prev.licenses.includes(p.license)) prev.licenses.push(p.license);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/** 1つの名前を 許す / 入れない / 注意 / 知らない に分ける */
const classifyId = (id, policy) => {
  if ((policy.deny ?? []).some((p) => matches(p, id))) return "入れない";
  if ((policy.allow ?? []).some((p) => matches(p, id))) return "許す";
  if ((policy.caution ?? []).some((p) => matches(p, id))) return "注意";
  return "知らない";
};

const RANK = { 許す: 0, 注意: 1, 知らない: 2, 入れない: 3 };
const best = (classes) => classes.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
const worst = (classes) => classes.reduce((a, b) => (RANK[a] >= RANK[b] ? a : b));

/**
 * SPDX の式(`MIT OR Apache-2.0`・`(A AND B)`)を分ける。OR はどれか1つを選べる(良い方)、AND は全部に従う(悪い方)。
 * 括弧の入れ子は外して読む(依存に出てくる式は1段だけ)
 */
export const classify = (expression, policy) => {
  const flat = expression.replaceAll("(", " ").replaceAll(")", " ").trim();
  const ors = flat.split(/\s+OR\s+/);
  return best(
    ors.map((part) => worst(part.split(/\s+AND\s+/).map((id) => classifyId(id.trim(), policy)))),
  );
};

/** 1件の判定(版でライセンスが違えば、悪い方) */
export const classOf = (pkg, policy) => worst(pkg.licenses.map((l) => classify(l, policy)));

/**
 * 依存と決まりを照らし合わせる。返すのは問題の文の配列(空なら緑)。
 *   入れない(GPL・AGPL など)/ 知らない名前 / 注意なのに review に無い / review にあるが、もう無いか・ライセンスが変わった
 */
export const checkPolicy = (packages, policy) => {
  const reviewed = new Set((policy.review ?? []).map((r) => r.name));
  const present = new Map(packages.map((p) => [p.name, p]));
  return [
    ...packages.flatMap((p) => packageProblems(p, policy, reviewed)),
    ...(policy.review ?? []).flatMap((r) => reviewProblems(r, present.get(r.name))),
  ];
};

const packageProblems = (p, policy, reviewed) => {
  const cls = classOf(p, policy);
  const at = `${p.name}(${p.licenses.join(" / ")})`;
  if (cls === "入れない") return [`${at}は入れないライセンス。MIT のキットと合わない`];
  if (reviewed.has(p.name)) return [];
  if (cls === "知らない")
    return [`${at}は決まりに無いライセンス。allow・caution・deny に足すか、review に1件書く`];
  if (cls === "注意") return [`${at}は注意のライセンス。review に、なぜ使ってよいかを1件書く`];
  return [];
};

const reviewProblems = (r, p) => {
  const out = [];
  if (!p) out.push(`review の ${r.name} は、もう依存に無い(消す)`);
  else if (!p.licenses.includes(r.license))
    out.push(
      `review の ${r.name} は ${r.license} と書いたが、今は ${p.licenses.join(" / ")}(確かめ直す)`,
    );
  if (!r.why) out.push(`review の ${r.name} に why(なぜ使ってよいか)が無い`);
  return out;
};

/** 自分たちの package.json(workspace)の直接の依存: [{ name, kind: 本番|開発, where }]。workspace: の物は除く */
export const directDeps = (manifests) => {
  const map = new Map();
  for (const { path, json } of manifests) {
    const where = path === "package.json" ? "(ルート)" : path.replace(/\/package\.json$/, "");
    for (const [field, kind] of [
      ["dependencies", "本番"],
      ["devDependencies", "開発"],
    ])
      for (const [name, spec] of Object.entries(json[field] ?? {})) {
        if (String(spec).startsWith("workspace:")) continue;
        const prev = map.get(name) ?? { name, kinds: new Set(), wheres: new Set() };
        prev.kinds.add(kind);
        prev.wheres.add(where);
        map.set(name, prev);
      }
  }
  return [...map.values()]
    .map((d) => ({
      name: d.name,
      kind: d.kinds.has("本番") ? "本番" : "開発",
      where: [...d.wheres].sort().join("・"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
