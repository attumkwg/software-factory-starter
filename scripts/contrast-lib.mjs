// 色のトークン(packages/ui/src/tokens.css)の文字と背景の組ごとに、コントラストの比を計算する中身。入口は contrast.mjs。
// 決まりは docs/design-system.md と WCAG 2.2 AA(文字 4.5:1・押す所やフォーカスの枠など文字でない物 3:1)。
// 比は切り捨てで出す(4.499 を 4.5 と見せない)。Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む。

// 画面で実際に重なる組(packages/ui/src/styles.css で前景と背景になる物)。
//   text: 文字(4.5:1)/ ui: 文字でない物(フォーカスの枠・選んだ印。3:1)/ info: 参考(落とさない)
export const PAIRS = [
  { fg: "--color-text", bg: "--color-bg", level: "text", where: "本文" },
  {
    fg: "--color-text",
    bg: "--color-surface",
    level: "text",
    where: "面(カード・表の見出し)の上の本文",
  },
  { fg: "--color-text-muted", bg: "--color-bg", level: "text", where: "補足の文字" },
  { fg: "--color-text-muted", bg: "--color-surface", level: "text", where: "面の上の補足の文字" },
  { fg: "--color-on-primary", bg: "--color-primary", level: "text", where: "主のボタン" },
  {
    fg: "--color-on-primary",
    bg: "--color-primary-hover",
    level: "text",
    where: "主のボタン(重ねたとき)",
  },
  { fg: "--color-on-danger", bg: "--color-danger", level: "text", where: "危険のボタン" },
  {
    fg: "--color-on-danger",
    bg: "--color-danger-hover",
    level: "text",
    where: "危険のボタン(重ねたとき)",
  },
  { fg: "--color-primary", bg: "--color-bg", level: "text", where: "リンク・文字だけのボタン" },
  { fg: "--color-primary", bg: "--color-surface", level: "text", where: "面の上のリンク" },
  { fg: "--color-danger", bg: "--color-bg", level: "text", where: "エラーの文" },
  { fg: "--color-danger", bg: "--color-surface", level: "text", where: "面の上のエラーの文" },
  { fg: "--color-info", bg: "--color-bg", level: "text", where: "お知らせの札" },
  { fg: "--color-info", bg: "--color-surface", level: "text", where: "面の上のお知らせの文" },
  { fg: "--color-success", bg: "--color-bg", level: "text", where: "成功の札" },
  { fg: "--color-warning", bg: "--color-bg", level: "text", where: "注意の札" },
  { fg: "--color-focus", bg: "--color-bg", level: "ui", where: "フォーカスの枠" },
  { fg: "--color-focus", bg: "--color-surface", level: "ui", where: "面の上のフォーカスの枠" },
  { fg: "--color-primary", bg: "--color-bg", level: "ui", where: "選んだチェックボックス" },
  {
    fg: "--color-border-control",
    bg: "--color-bg",
    level: "ui",
    where: "操作する部品の枠(入力欄・選択・チェックボックス・副のボタン)",
  },
  {
    fg: "--color-border-control",
    bg: "--color-surface",
    level: "ui",
    where: "面の上の操作する部品の枠",
  },
  {
    fg: "--color-border",
    bg: "--color-bg",
    level: "info",
    where: "区切りの線・カードの枠(飾りの線なので参考)",
  },
];

export const NEED = { text: 4.5, ui: 3, info: 3 };

/** "#rgb" / "#rrggbb"(と不透明の "#rrggbbff")を [r, g, b] に。それ以外(rgb() や半透明)は null。 */
export function parseHex(value) {
  const v = value.trim().toLowerCase();
  if (!v.startsWith("#")) return null;
  let hex = v.slice(1);
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  if (hex.length === 8 && hex.endsWith("ff")) hex = hex.slice(0, 6);
  if (hex.length !== 6) return null;
  for (const c of hex) if (!"0123456789abcdef".includes(c)) return null;
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

/** WCAG の相対輝度(sRGB)。 */
export function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 2つの色のコントラストの比(1〜21)。切り捨てで小数2桁。 */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.floor(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** "{ ... }" の中の "--name: value;" を読む。 */
function readDeclarations(body) {
  const out = {};
  for (const raw of body.split(";")) {
    const line = stripComments(raw).trim();
    if (!line.startsWith("--")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("/*", i);
    if (start < 0) return out + text.slice(i);
    out += text.slice(i, start);
    const end = text.indexOf("*/", start + 2);
    if (end < 0) return out;
    i = end + 2;
  }
  return out;
}

/** start の位置の "{" と対になる "}" の位置。 */
function closingBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * tokens.css を読み、明るいテーマ(最初の :root)と暗いテーマ(prefers-color-scheme: dark の中の :root を明るい方に重ねた物)を返す。
 * 暗いテーマが無ければ dark は null。
 */
export function parseTokens(css) {
  const text = stripComments(css);
  const darkAt = text.indexOf("prefers-color-scheme: dark");
  const rootAt = text.indexOf(":root");
  if (rootAt < 0) throw new Error(":root が無い");
  const lightOpen = text.indexOf("{", rootAt);
  const light = readDeclarations(text.slice(lightOpen + 1, closingBrace(text, lightOpen)));
  if (darkAt < 0) return { light, dark: null };
  const mediaOpen = text.indexOf("{", darkAt);
  const media = text.slice(mediaOpen + 1, closingBrace(text, mediaOpen));
  const innerOpen = media.indexOf("{");
  const darkOwn = readDeclarations(media.slice(innerOpen + 1, closingBrace(media, innerOpen)));
  return { light, dark: { ...light, ...darkOwn } };
}

/** 1つのテーマの組ごとの結果。色が読めない組は ok: false・ratio: null。 */
export function checkTheme(theme, pairs = PAIRS) {
  return pairs.map((p) => {
    const fg = theme[p.fg] === undefined ? null : parseHex(theme[p.fg]);
    const bg = theme[p.bg] === undefined ? null : parseHex(theme[p.bg]);
    const need = NEED[p.level];
    if (fg === null || bg === null)
      return { ...p, fgValue: theme[p.fg], bgValue: theme[p.bg], ratio: null, need, ok: false };
    const ratio = contrastRatio(fg, bg);
    return { ...p, fgValue: theme[p.fg], bgValue: theme[p.bg], ratio, need, ok: ratio >= need };
  });
}

/** 落とす組(info 以外で届かない・読めない)。 */
export function failures(rows) {
  return rows.filter((r) => r.level !== "info" && !r.ok);
}

/** PR に貼る表(Markdown)。 */
export function renderTable(title, rows) {
  const mark = (r) => {
    if (r.ratio === null) return "❌ 色が読めない";
    if (r.ok) return "✅";
    return r.level === "info" ? "⚠️ 参考" : "❌";
  };
  const lines = [
    `#### ${title}`,
    "",
    "| 前景 | 背景 | どこ | 比 | 要る比 | 判定 |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| \`${r.fg}\` ${r.fgValue ?? "(無い)"} | \`${r.bg}\` ${r.bgValue ?? "(無い)"} | ${r.where} | ${r.ratio === null ? "—" : `${r.ratio.toFixed(2)}:1`} | ${r.need}:1 | ${mark(r)} |`,
    ),
  ];
  return lines.join("\n");
}
