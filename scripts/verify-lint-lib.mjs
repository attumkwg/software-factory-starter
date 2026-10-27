// PR の動作確認の手順(apps/web/e2e/verify/*.spec.ts)の危ない書き方を止める(1層目)。入口は verify-lint.mjs。
// 「スクリプトが通った ≠ 確かめた」。すり抜けた物は AI が記録とトレースを疑って読む(2層目。docs/guides/verify-pr.md)。
// 設計は docs/designs/0076-verify-pr.md。書き方で止められない物(操作の前から合格の中身・判定の取り違え)は2層目に残る。

// 準備のためだけに画面の外を使う行の印(同じ行か前の行)。確かめは画面で行う
export const SETUP_MARK = "// 準備:";

// 1行ずつ見る決まり: [名前, 当たる形, 文]
const LINE_RULES = [
  [
    "エラーの放置",
    /\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*(\{\s*\}|undefined|null|void 0)|catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/,
    "失敗を握りつぶしている。失敗はそのまま落とす",
  ],
  ["エラーの放置", /\btry\s*\{/, "try で包むと、失敗が合格に化ける。包まずに落とす"],
  [
    "API の直叩き",
    /\b(page|context)\.request\b|\brequest\.(get|post|put|patch|delete|head|fetch)\(|\bfetch\(|\bnewContext\(|APIRequestContext/,
    "API を直に叩くと画面を確かめていない。画面で操作する(準備だけなら行に「// 準備: 理由」)",
  ],
  ["判定のすり替え", /\.(route|routeFromHAR|unroute)\(/, "応答を差し替えると本物を確かめていない"],
  [
    "判定のすり替え",
    /\.(evaluate|evaluateHandle|\$eval|\$\$eval|addInitScript|exposeFunction)\(/,
    "画面の中を直に読む・書き換えるのは操作ではない。役割と名前で取って操作する",
  ],
  [
    "判定のすり替え",
    /\bexpect\(\s*(true|false|null|undefined|-?\d+|"[^"]*"|'[^']*')\s*[,)]/,
    "決まった値を確かめても何も確かめていない",
  ],
  ["判定のすり替え", /\bexpect\.soft\(/, "expect.soft は落ちても合格に残る。expect を使う"],
  [
    "不適切な操作",
    /force:\s*true/,
    "押せない物を押している(利用者には押せない)。押せる状態になるのを待つ",
  ],
  [
    "非同期の偽陽性",
    /\bwaitForTimeout\(/,
    "時間で待つと、間に合わないと偽の合格・不合格になる。画面の変化を expect で待つ",
  ],
  [
    "確認を飛ばす",
    /\btest\.(skip|fixme|fail|only)\(|\bdescribe\.only\(/,
    "飛ばした確認は確認ではない",
  ],
];

// ここから下は正規表現を使わずに読む(手順の文に正規表現を当てる所を作らない。Semgrep の regex_dos)
const ACTIONS = [
  "click",
  "dblclick",
  "fill",
  "press",
  "pressSequentially",
  "check",
  "uncheck",
  "selectOption",
  "setInputFiles",
  "dragTo",
  "tap",
].map((name) => `.${name}(`);
const isWord = (c) =>
  c !== undefined &&
  ((c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "_" ||
    c === "$");
// name( の呼び出しが、ほかの名前の一部(expectAccessible)や . の後(test.step)でなく出てくるか
const calls = (line, name) => {
  for (let at = line.indexOf(`${name}(`); at >= 0; at = line.indexOf(`${name}(`, at + 1)) {
    const prev = line[at - 1];
    if (prev !== "." && !isWord(prev)) return true;
  }
  return false;
};
const hasAction = (line) => ACTIONS.some((a) => line.includes(a));
const hasExpect = (line) => calls(line, "expect") || line.includes("expect.poll(");
// .toHaveText( などの判定の名前(.not. を挟んでもよい)
const matchersOf = (text) => {
  const names = [];
  for (let at = text.indexOf(".to"); at >= 0; at = text.indexOf(".to", at + 1)) {
    let end = at + 3;
    while (isWord(text[end])) end += 1;
    const name = text.slice(at + 1, end);
    const upper = name[2];
    if (text[end] === "(" && upper >= "A" && upper <= "Z") names.push(name);
  }
  return names;
};
// 有る・無い・押せるだけを見る(中身を見ない)物
const PRESENCE = new Set([
  "toBeVisible",
  "toBeHidden",
  "toBeAttached",
  "toBeTruthy",
  "toBeFalsy",
  "toBeDefined",
  "toBeUndefined",
  "toBeNull",
  "toBeEnabled",
  "toBeDisabled",
]);

// 行の注釈(// の後ろ)を外す。URL の // は残す
const codeOf = (line) => {
  for (let at = line.indexOf("//"); at >= 0; at = line.indexOf("//", at + 1)) {
    const prev = line[at - 1];
    if (prev === undefined || prev === " " || prev === "\t") return line.slice(0, at);
  }
  return line;
};

const lineProblems = (lines) => {
  const out = [];
  lines.forEach((raw, i) => {
    const code = codeOf(raw);
    const marked = raw.includes(SETUP_MARK) || (lines[i - 1] ?? "").includes(SETUP_MARK);
    for (const [rule, pattern, message] of LINE_RULES) {
      if (!pattern.test(code)) continue;
      if (rule === "API の直叩き" && marked && !hasExpect(code)) continue;
      out.push({ line: i + 1, rule, message });
    }
  });
  return out;
};

// 1本の確認(test の中)の決まり。start は test( の行(0から)
const testProblems = (lines, start) => {
  const code = lines.map(codeOf);
  const at = (found) => code.flatMap((l, i) => (found(l) ? [i] : []));
  const expects = at(hasExpect);
  const line = start + 1;
  if (expects.length === 0)
    return [{ line, rule: "アサーション無し", message: "確かめ(expect)が1つも無いのに合格になる" }];
  const out = [];
  const names = matchersOf(code.join("\n"));
  if (names.length > 0 && names.every((n) => PRESENCE.has(n)))
    out.push({
      line,
      rule: "うわべの確認",
      message: "有るか・見えるかだけを見ている。中身(文言・値・件数・URL)も確かめる",
    });
  const actions = at(hasAction);
  if (actions.length > 0) {
    const last = actions.at(-1);
    if (!expects.some((i) => i < last))
      out.push({
        line,
        rule: "操作の前から合格",
        message: "操作の前の状態を確かめていない(前から合格の条件を満たしていないかを先に見る)",
      });
    if (!expects.some((i) => i > last))
      out.push({ line, rule: "アサーション無し", message: "最後の操作の後に確かめが無い" });
  }
  return out;
};

/** 1つのファイルの問題: [{ line, rule, message }] */
export function lintVerify(text) {
  const lines = text.split("\n");
  const out = lineProblems(lines);
  if (!text.includes("verify-fixture"))
    out.push({
      line: 1,
      rule: "記録が取れない",
      message: "test と expect は ../verify-fixture から取る(画面のエラーと失敗した通信を記録する)",
    });
  const starts = lines.flatMap((l, i) => (calls(codeOf(l), "test") ? [i] : []));
  starts.forEach((s, k) => {
    out.push(...testProblems(lines.slice(s, starts[k + 1] ?? lines.length), s));
  });
  return out.sort((a, b) => a.line - b.line);
}
