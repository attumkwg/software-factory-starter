// キットが自分の中で閉じているか(外の人が、キットの外を見ずに理由と考え方を辿れるか)を確かめる中身。
// 入口は self-contained.mjs。根拠の置き場所は docs/concepts/ と docs/security.md の決まり(番号つき)。
// Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む。

// キットの外を指す言葉。見つけたら落とす(大文字・小文字は区別しない)
export const OUTSIDE_WORDS = [
  {
    word: "my-life",
    why: "作者の非公開のリポジトリ。中身を docs/concepts/ か docs/security.md に書き起こして、そこを指す",
  },
  { word: "docs/software-factory", why: "キットの外の資料。docs/concepts/ を指す" },
  {
    word: "software-factory-starter-archive",
    why: "非公開の元のリポジトリ。PR の番号ではなく、キットの中の ADR・設計書を指す",
  },
];

// 「本人」はキットでは「ログインした利用者」の意味で使う。決めた人は名前で書く
export const AUTHOR_WORDS = ["本人の選択", "本人の決定"];

// 外の資料のファイル名。キットに同じ名前のファイルが無いのに出てきたら落とす
export const OUTSIDE_FILES = [
  "scale.md",
  "build.md",
  "roles.md",
  "operations.md",
  "tools.md",
  "privacy.md",
  "product-bets.md",
];

// docs/security.md の決まりの番号の頭(AI-1・AZ-1・L-1・T-1・V-1・D-1)
export const ID_PREFIXES = ["AI", "AZ", "L", "T", "V", "D"];

const isDigit = (c) => c >= "0" && c <= "9";
const isUpper = (c) => c >= "A" && c <= "Z";
const isNameChar = (c) =>
  (c >= "a" && c <= "z") || isUpper(c) || isDigit(c) || c === "-" || c === "_" || c === ".";

/** 「T-6」の形(頭が ID_PREFIXES のどれか・数字)か */
export const isRuleId = (s) => {
  const dash = s.indexOf("-");
  if (dash < 1) return false;
  const head = s.slice(0, dash);
  const num = s.slice(dash + 1);
  return ID_PREFIXES.includes(head) && num.length > 0 && [...num].every(isDigit);
};

/** 文の中の決まりの番号(T-6 など)を、出てきた順に返す */
export const ruleIdsIn = (text) => {
  const ids = [];
  let word = "";
  for (const c of `${text} `) {
    if (isUpper(c) || isDigit(c) || c === "-") {
      word += c;
      continue;
    }
    if (isRuleId(word)) ids.push(word);
    word = "";
  }
  return ids;
};

/** docs/security.md の表の行のうち、1列目が番号で始まる物(「| T-6 |」「| D-3 自社専用の… |」)を集める */
export const definedRuleIds = (securityMd) => {
  const ids = new Set();
  for (const line of securityMd.split("\n")) {
    const cells = line.split("|");
    if (cells.length < 3 || cells[0].trim() !== "") continue;
    const first = cells[1].trim().split(" ")[0];
    if (isRuleId(first)) ids.add(first);
  }
  return ids;
};

/** name が text の中に、前後が名前の一部でない形で出てくる位置(「account-security.md」の中の「security.md」は数えない) */
export const positionsOf = (text, name) => {
  const out = [];
  let at = text.indexOf(name);
  while (at >= 0) {
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + name.length] ?? "";
    // 後ろが「.md」の続き(英数字)でないこと。前が名前の一部(英数字・-・_・.)でないこと。/ は区切りとして許す
    if (!(before && isNameChar(before)) && !(after && isNameChar(after) && after !== "."))
      out.push(at);
    at = text.indexOf(name, at + 1);
  }
  return out;
};

// 「security.md」の後ろ、引いている番号を読む範囲(行の終わり・閉じかっこ・句点まで)
const STOP = ["\n", ")", "」", "。", "]", "`", "|"];
const WINDOW = 40;

const SKIP_BEFORE_NUMBER = [" ", "の", "「"];

// 「の」「 」を飛ばした最初の文字が数字なら、その番号(外の資料の節の番号)。違えば undefined
const leadingNumber = (rest) => {
  let i = 0;
  while (i < rest.length && SKIP_BEFORE_NUMBER.includes(rest[i])) i += 1;
  let num = "";
  while (i < rest.length && (isDigit(rest[i]) || (num !== "" && rest[i] === "."))) num += rest[i++];
  return num === "" ? undefined : num;
};

// 止まる所まで。「AZ-6「大事な操作は監査ログ」・T-7」のように、かぎかっこの中は飛ばして読む
const untilStop = (rest) => {
  let cut = "";
  let depth = 0;
  for (const c of rest) {
    if (c === "「") depth += 1;
    else if (c === "」" && depth > 0) depth -= 1;
    else if (depth > 0) continue;
    else if (STOP.includes(c)) break;
    else cut += c;
  }
  return cut;
};

/** 「security.md」のすぐ後ろを読む: 外の番号(「4.3」「の 5」)か、決まりの番号(T-6)の一覧か */
export const securityRefAt = (text, at) => {
  const from = at + "security.md".length;
  const rest = text.slice(from, from + WINDOW);
  const outsideNumber = leadingNumber(rest);
  return outsideNumber === undefined ? { ids: ruleIdsIn(untilStop(rest)) } : { outsideNumber };
};

const AUTHOR_HINT =
  "決めた人を名前で書く(例: 「作者 @名前 の選択」)。キットの「本人」はログインした利用者";

// 1行の中の、外を指す言葉・「本人の選択」・キットに無い外のファイル名
const wordProblems = (line, ctx) => {
  const lower = line.toLowerCase();
  return [
    ...OUTSIDE_WORDS.filter(({ word }) => lower.includes(word)).map(
      ({ word, why }) => `「${word}」を指している。${why}`,
    ),
    ...AUTHOR_WORDS.filter((word) => line.includes(word)).map(
      (word) => `「${word}」→ ${AUTHOR_HINT}`,
    ),
    ...OUTSIDE_FILES.filter(
      (name) => !ctx.basenames.has(name) && positionsOf(line, name).length > 0,
    ).map((name) => `「${name}」はキットに無い(外の資料)。docs/concepts/ の該当の節を指す`),
  ];
};

// 1行の中の「security.md …」の引き方
const securityProblems = (line, ctx) =>
  positionsOf(line, "security.md").flatMap((at) => {
    const ref = securityRefAt(line, at);
    if (ref.outsideNumber !== undefined)
      return [
        `「security.md ${ref.outsideNumber}」は外の資料の節の番号。docs/security.md の決まりの番号(T-6 など)で引く`,
      ];
    return ref.ids
      .filter((id) => !ctx.ruleIds.has(id))
      .map((id) => `「security.md の ${id}」が docs/security.md に無い`);
  });

/**
 * 1つのファイルを確かめる。
 * ctx.ruleIds … docs/security.md にある決まりの番号(Set)/ ctx.basenames … リポジトリにあるファイル名(Set)
 * 返すのは [{ line, message }]
 */
export const checkText = (text, ctx) =>
  text.split("\n").flatMap((line, index) =>
    [...wordProblems(line, ctx), ...securityProblems(line, ctx)].map((message) => ({
      line: index + 1,
      message,
    })),
  );

// 読まないファイル(この検査の中身とテストは、外を指す言葉そのものを持つ)
export const SKIP_FILES = [
  "scripts/self-contained.mjs",
  "scripts/self-contained-lib.mjs",
  "scripts/self-contained.test.mjs",
  "pnpm-lock.yaml",
];
const BINARY = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".pdf",
  ".zip",
];

/** 読むファイルか(テキストで、検査の対象) */
export const shouldRead = (path) =>
  !SKIP_FILES.includes(path) && !BINARY.some((ext) => path.toLowerCase().endsWith(ext));
