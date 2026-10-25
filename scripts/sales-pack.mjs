// 稟議の資料の束(営業がお客さんの稟議に添える1つの Markdown)。docs/guides/sales.md の 3・設計書 0053。
//   pnpm sales:pack --out <ファイル>   キットの型(仕組みの事実・SLA・個人データの取り扱い・委託先)を1つにまとめ、
//                                      出す前に埋める所(<…>・YYYY・◯ など)の一覧を頭に付ける
// 束は型をまとめるだけ。お客さんの名前・金額・質問票の答えは、書き出した後に人が足す(リポジトリの外で)。
// 書き出す先はリポジトリの外をすすめる(会社ごとに直した物を、間違えてコミットしないため)。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** 束に入れる型(並び順)。正は各ファイル */
export const PACK = [
  {
    file: "docs/legal/README.md",
    title: "仕組みの事実(キットの作りから決まる項目)",
    section: "## 2.",
  },
  { file: "docs/legal/sla.md", title: "SLA(稼働の約束)の型" },
  { file: "docs/legal/data-processing.md", title: "個人データの取り扱いの取り決めの型" },
  { file: "docs/compliance/vendors.md", title: "委託先の一覧" },
];

/** 見出しの深さ(行頭の # の数。後ろに空白が無ければ見出しではないので 0)。正規表現を使わない */
const headingDepth = (line) => {
  let n = 0;
  while (line[n] === "#") n += 1;
  return n > 0 && (line[n] === " " || line[n] === "\t") ? n : 0;
};

/** 節だけを取り出す(見出しから、同じ深さの次の見出しの前まで) */
export function sectionOf(text, heading) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(heading));
  if (at < 0) return text;
  const depth = headingDepth(heading) || 2;
  const end = lines.findIndex((l, i) => {
    const d = headingDepth(l);
    return i > at && d > 0 && d <= depth;
  });
  return lines.slice(at, end < 0 ? undefined : end).join("\n");
}

/** キットの中へのリンク([文](相対のパス))は文だけにする(束の外では開けない)。外の URL は残す */
export const flattenLinks = (text) => text.replace(/\[([^\]]+)\]\((?!https?:)[^)]+\)/g, "$1");

/** HTML の注(<!-- -->)を落とす */
const stripComments = (text) => text.replace(/<!--[\s\S]*?-->/g, "");

/** 出す前に埋める所(<…>・YYYY・◯・「仮の既定」)。どの型の何行目か */
export function blanksOf(title, text) {
  const out = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((line, i) => {
    // コードの塊(```)の中は、コマンドの例なので数えない
    if (line.trim().startsWith("```")) fenced = !fenced;
    if (fenced) return;
    const code = line.replace(/`[^`]*`/g, "");
    if (/<[^<>\n]{1,40}>|YYYY|◯|仮の既定/.test(code))
      out.push(`${title} の ${i + 1}行目: ${line.trim().slice(0, 80)}`);
  });
  return out;
}

/** 束の Markdown。read(path) はファイルの中身(テストでは偽物) */
export function makePack({ read, today, commit }) {
  const parts = PACK.map((p) => {
    const raw = read(p.file);
    if (raw === undefined) return { ...p, body: `(${p.file} が無い)`, blanks: [] };
    const body = flattenLinks(stripComments(p.section ? sectionOf(raw, p.section) : raw)).trim();
    return { ...p, body, blanks: blanksOf(p.title, body) };
  });
  const blanks = parts.flatMap((p) => p.blanks);
  return [
    `# 稟議の資料(${today} に作った・キット ${commit ?? "(版不明)"})`,
    "",
    "> この束は型をまとめた物。**お客さんに出す前に、専門家(弁護士など)に文面を確かめる**。会社ごとに変えた条件は、この会社の契約の側に残す(docs/legal/README.md の 4)。",
    "> セキュリティの質問票の答えは `/security-questionnaire` の下書き(リポジトリの外)を、この後ろに付ける。",
    "",
    `## 出す前に埋める所(${blanks.length}件)`,
    "",
    ...(blanks.length ? blanks.map((b) => `- ${b}`) : ["- なし"]),
    "",
    ...parts.flatMap((p, i) => [`## ${i + 1}. ${p.title}`, "", `> 元: ${p.file}`, "", p.body, ""]),
  ].join("\n");
}

if (import.meta.main) {
  const at = process.argv.indexOf("--out");
  const out = at >= 0 ? process.argv[at + 1] : undefined;
  if (!out) {
    console.error("使い方: pnpm sales:pack --out <ファイル>(リポジトリの外をすすめる)");
    process.exit(1);
  }
  const read = (f) => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return undefined;
    }
  };
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  let commit = null;
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // git が無ければ版不明
  }
  const text = makePack({ read, today, commit });
  writeFileSync(out, `${text}\n`);
  const inside = resolve(out).startsWith(resolve("."));
  console.log(`稟議の資料を書きました → ${out}`);
  if (inside)
    console.log("⚠ リポジトリの中に書きました。会社ごとに直したらコミットしないでください");
}
