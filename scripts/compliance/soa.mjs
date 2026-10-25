// 適用宣言書(docs/compliance/soa.md)を、管理策の一覧・点検の台帳・規程から作る。手で書かない。
// 今日の日付や確かめた結果は入れない(置いてある物と作った物を比べて、古さを CI で見つけるため)。
import { posix } from "node:path";
import { CONTROLS_FILE, DIR } from "./lib.mjs";

const THEMES = [
  { prefix: "A.5.", name: "組織の管理策(A.5)" },
  { prefix: "A.6.", name: "人の管理策(A.6)" },
  { prefix: "A.7.", name: "物理的な管理策(A.7)" },
  { prefix: "A.8.", name: "技術的な管理策(A.8)" },
];

const cell = (s) =>
  String(s ?? "")
    .replaceAll("|", "/")
    .replaceAll("\n", " ")
    .trim();
const link = (path) => `[${posix.basename(path)}](${posix.relative(DIR, path)})`;
const uniq = (xs) => [...new Set(xs)];

/** 管理策ごとの、当たる点検の項目・証跡・規程 */
function indexByControl(ledger, policies) {
  const items = new Map();
  const evidence = new Map();
  const add = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const item of ledger?.items ?? []) {
    if (item.status === "retired") continue;
    for (const c of item.controls ?? []) {
      add(items, c, item.id);
      for (const e of item.evidence ?? []) add(evidence, c, e);
    }
  }
  const byPolicy = new Map();
  for (const p of policies) for (const c of p.meta?.controls ?? []) add(byPolicy, c, p.file);
  return { items, evidence, byPolicy };
}

function row(c, idx) {
  const items = idx.items.get(c.id) ?? [];
  const evidence = uniq([...(c.evidence ?? []), ...(idx.evidence.get(c.id) ?? [])]);
  const refs = uniq([...(idx.byPolicy.get(c.id) ?? []), ...(c.refs ?? [])]);
  return [
    c.id,
    cell(c.name),
    c.applies ? "適用" : "除外",
    cell(c.why),
    c.applies ? cell(c.how) : "—",
    items.map((i) => `\`${i}\``).join(" "),
    evidence.map((e) => `\`${e}\``).join(" "),
    refs.map(link).join(" "),
  ];
}

export function renderSoa({ catalog, ledger, policies }) {
  const controls = catalog?.controls ?? [];
  const idx = indexByControl(ledger, policies);
  const applied = controls.filter((c) => c.applies).length;
  const lines = [
    "# 適用宣言書(SoA)",
    "",
    `> この1枚は [controls.yaml](${posix.relative(DIR, CONTROLS_FILE)})(管理策の一覧。ここが正)・[点検の台帳](../checkup/todo.yaml)・[規程](policies/) から \`pnpm compliance --write\` で作る。手で直さない(古いと CI の \`pnpm compliance\` が落ちる)。`,
    `> 規格: ${catalog?.standard ?? "ISO/IEC 27001:2022 附属書 A"}。管理策の名前は、このキットでの言い換え(正式な名前と中身は規格の本文で確かめる)。`,
    `> 適用 ${applied}件・除外 ${controls.length - applied}件(全 ${controls.length}件)。${catalog?.scope ?? ""}`,
    "> 点検の項目 = [docs/checkup/README.md](../checkup/README.md) の id(毎週・毎月の確かめと答えの記録)。証跡 = `evidence.yml` が毎月、消せない置き場に集める物の名前(`pnpm evidence --list`)。使い方は [README.md](README.md)",
  ];
  for (const t of THEMES) {
    const rows = controls.filter((c) => String(c.id).startsWith(t.prefix)).map((c) => row(c, idx));
    lines.push(
      "",
      `## ${t.name}`,
      "",
      "| 番号 | 管理策 | 適用 | 理由 | このキットでの実施 | 点検の項目 | 証跡 | 規程・根拠 |",
      "|---|---|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.join(" | ")} |`),
    );
  }
  return `${lines.join("\n")}\n`;
}
