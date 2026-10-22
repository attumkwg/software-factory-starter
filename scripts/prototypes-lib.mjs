// 試作(prototypes/<賭けの ID>-<短い名前>/)を確かめる中身。入口は prototypes.mjs。
// 決まりは docs/guides/prototypes.md。Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む。

// 終わった賭け。試作のフォルダが残っていたら知らせる(消す。置き場所からも main に入れば消える)
export const CLOSED = ["dropped", "adopted", "retired"];

// 試作から使ってはいけない物(本物の API・DB・AWS・秘密・監視)。@app/ui(デザインシステム)だけは使ってよい
const DENIED = [
  "@app/",
  "@aws-sdk/",
  "aws-sdk",
  "@smithy/",
  "pg",
  "postgres",
  "drizzle-orm",
  "drizzle-kit",
  "@sentry/",
  "dotenv",
  "pino",
];
const ALLOWED = ["@app/ui"];
// 画面のコード(src)では、ブラウザに無い物(ファイル・プロセス)も使わない
const SERVER_ONLY = ["node:", "fs", "child_process", "process"];

const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");

// 「B-0002-morning-digest」から「B-0002」。形が違えば undefined
export const idOfDir = (name) => {
  const id = name.slice(0, 6);
  const ok = id.startsWith("B-") && isDigits(id.slice(2)) && name[6] === "-" && name.length > 7;
  return ok ? id : undefined;
};

// 「@app/」「node:」のように区切りで終わる名前は、頭が同じなら当たる
const matches = (spec, name) =>
  spec === name ||
  spec.startsWith(`${name}/`) ||
  ((name.endsWith("/") || name.endsWith(":")) && spec.startsWith(name));

// 使ってはいけない名前なら、その名前を返す
export const deniedName = (spec, { src = false } = {}) => {
  if (ALLOWED.some((a) => matches(spec, a))) return undefined;
  const list = src ? [...DENIED, ...SERVER_ONLY] : DENIED;
  return list.find((d) => matches(spec, d));
};

// import / export … from "x"・import "x"・import("x") の "x" を集める
export const importsOf = (text) => {
  const specs = [];
  for (const key of ['from "', "from '", 'import "', "import '", 'import("', "import('"]) {
    let at = text.indexOf(key);
    while (at >= 0) {
      const start = at + key.length;
      const end = text.indexOf(key.at(-1), start);
      if (end > start) specs.push(text.slice(start, end));
      at = text.indexOf(key, start);
    }
  }
  return specs;
};

// 相対パスが試作のフォルダの外に出るか(file は試作のフォルダからの相対パス。"/" 区切り)
export const escapes = (file, spec) => {
  if (!spec.startsWith(".")) return false;
  const parts = file.split("/").slice(0, -1);
  for (const p of spec.split("/")) {
    if (p === "..") {
      if (parts.length === 0) return true;
      parts.pop();
    } else if (p !== "." && p !== "") parts.push(p);
  }
  return false;
};

// 1つのファイルの import を確かめる
export const checkSource = (file, text) => {
  const problems = [];
  const src = file.startsWith("src/");
  for (const spec of importsOf(text)) {
    const name = deniedName(spec, { src });
    if (name) problems.push(`${file}: 「${spec}」は使わない(本物の API・DB・AWS・秘密に触らない)`);
    else if (escapes(file, spec))
      problems.push(`${file}: 「${spec}」は試作のフォルダの外(apps/ など)を読んでいる`);
    else if (spec.includes(".env"))
      problems.push(`${file}: 「${spec}」.env を読まない(秘密を試作に入れない)`);
  }
  if (text.includes("import.meta.env.VITE_"))
    problems.push(`${file}: import.meta.env.VITE_* を使わない(値は偽のデータとして src に書く)`);
  return problems;
};

// package.json の依存を確かめる
export const checkDeps = (pkg) => {
  const problems = [];
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(pkg[field] ?? {})) {
      if (deniedName(name)) problems.push(`package.json の ${field}: ${name} は入れない`);
      else if (String(version).startsWith("workspace:") && !ALLOWED.includes(name))
        problems.push(`package.json の ${field}: ${name}(ワークスペースは @app/ui だけ)`);
    }
  }
  return problems;
};

export const hasNoindex = (html) => {
  const lower = html.toLowerCase();
  const at = lower.indexOf('name="robots"');
  if (at < 0) return false;
  const tagEnd = lower.indexOf(">", at);
  return lower.slice(at, tagEnd).includes("noindex");
};

// 賭けのファイルの「- 段階: …」(<!-- … --> の中は読まない)
export const stageOf = (text) => {
  let body = text;
  for (;;) {
    const open = body.indexOf("<!--");
    if (open < 0) break;
    const close = body.indexOf("-->", open);
    body = body.slice(0, open) + (close < 0 ? "" : body.slice(close + 3));
  }
  const line = body.split("\n").find((l) => l.trim().startsWith("- 段階:"));
  return line?.trim().slice("- 段階:".length).trim();
};

// 1つの試作を確かめる。problems は CI を落とす物、warnings は知らせるだけ
export const checkPrototype = ({ dir, pkg, html, files, betFile, betStage }) => {
  const problems = [];
  const warnings = [];
  const id = idOfDir(dir);
  if (!id) return { problems: [`フォルダの名前は B-NNNN-<英語の短い名前>(「${dir}」)`], warnings };
  const expected = `@prototype/${dir.toLowerCase()}`;
  if (pkg.name !== expected) problems.push(`package.json の name は「${expected}」`);
  if (pkg.scripts?.test || pkg.scripts?.["test:coverage"])
    problems.push("package.json に test を置かない(捨てる物。カバレッジの下限の外)");
  problems.push(...checkDeps(pkg));
  if (html === undefined) problems.push("index.html が無い");
  else if (!hasNoindex(html))
    problems.push('index.html に <meta name="robots" content="noindex, nofollow" /> が無い');
  for (const [file, text] of Object.entries(files)) {
    if (file.split("/").at(-1)?.startsWith(".env")) problems.push(`${file}: .env を置かない`);
    else problems.push(...checkSource(file, text));
  }
  if (!betFile)
    problems.push(`賭け ${id} のファイルが docs/product/bets/ に無い(先に /bet で開く)`);
  else if (CLOSED.includes(betStage ?? ""))
    warnings.push(`賭け ${id} は ${betStage}(終わった賭け)。試作のフォルダを消す(/prototype)`);
  return { problems, warnings };
};
