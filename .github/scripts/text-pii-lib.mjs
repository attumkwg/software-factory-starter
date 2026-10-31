// 文の中の個人情報の形を見つける(PR の題名・本文・コミットの文と、背景の AI に読ませる文。Issue #205)。依存なし。
// PR・コミットの文は書いた瞬間に公開され、取り消せない。AI に読ませる文に入っていれば、AI がそれを写して外へ書きうる。
// 見つけた値は CI のログ(公開)に出さない。種類・場所(行と列)と、伏せた形だけを返す。
// 考え方は packages/logging/src/scrub-text.ts・packages/error-reporting/src/scrub.ts と同じ(CI の外の部品は読まない)。

/**
 * 許すメールアドレスのドメイン(この名前か、その下のドメイン)。足すときは、人に届かないと決まっている物だけ。理由を書く
 */
export const ALLOWED_EMAIL_DOMAINS = [
  { domain: "test", why: "予約のドメイン(RFC 2606)。テストの偽の宛先(acme.test など)" },
  { domain: "example", why: "予約のドメイン(RFC 2606)。例の宛先" },
  { domain: "invalid", why: "予約のドメイン(RFC 2606)。届かないと決まっている" },
  { domain: "localhost", why: "予約のドメイン(RFC 2606)。手元の宛先" },
  { domain: "example.com", why: "例のための予約のドメイン(RFC 2606)" },
  { domain: "example.net", why: "例のための予約のドメイン(RFC 2606)" },
  { domain: "example.org", why: "例のための予約のドメイン(RFC 2606)" },
  {
    domain: "users.noreply.github.com",
    why: "GitHub がメールを伏せた人に配る、届かない宛先(コミットの Co-authored-by に出る)",
  },
];

/** 許すメールアドレス(この宛先そのものだけ。ドメインの全部は許さない)。理由を書く */
export const ALLOWED_EMAILS = [
  {
    address: "noreply@anthropic.com",
    why: "AI のコミットの末尾の Co-Authored-By に書く、届かない宛先(人の宛先ではない)",
  },
  {
    address: "no-reply@verificationemail.com",
    why: "Cognito の既定の送り元(AWS の公開の宛先。infra/terraform の説明に出る)",
  },
];

/** 許す値(テストで使う、明らかな偽の値)。数字だけを比べる(区切りの違いは同じ物) */
export const ALLOWED_DIGITS = [
  {
    digits: "09000000000",
    why: "テストの偽の電話番号(090-0000-0000・09000000000。番号の部分が全部 0。結合テストとログの単体テスト)",
  },
];

// 全角の数字と区切りは半角と同じに見る(1文字を1文字に置くので、列の位置は変わらない)
const WIDE = /[０-９－‐−]/g;
const narrow = (text) =>
  text.replace(WIDE, (c) =>
    /[０-９]/.test(c) ? String.fromCharCode(c.charCodeAt(0) - 0xfee0) : "-",
  );

// 区切りは「-」だけ(全角・ダッシュは上で「-」に置き換えた)
const RULES = [
  {
    kind: "メールアドレス",
    // URL の中の認証の部分(https://key@host)はメールではないので当てない
    pattern: /(?<![\w.%+/-])[\w.%+-]+@[A-Za-z\d-]+(?:\.[A-Za-z\d-]+)*\.[A-Za-z]{2,}(?![\w-])/g,
    allowed: (value) => allowedEmail(value),
  },
  {
    kind: "電話番号",
    // 区切りのある番号(03-1234-5678・090-1234-5678・+81-90-1234-5678)。数字は 0 を入れて 10〜11桁
    pattern: /(?<![\w.+-])(?:\+81-?|0)\d{1,4}-\d{1,4}-\d{3,4}(?![\w-]|\.\d)/g,
    allowed: (value) => !phoneLength(value) || allowedDigits(value),
  },
  {
    kind: "電話番号",
    // 区切りの無い携帯・IP 電話(0X0 で始まる 11桁)
    pattern: /(?<![\w.+-])0[5789]0\d{8}(?![\w-]|\.\d)/g,
    allowed: (value) => allowedDigits(value),
  },
  {
    kind: "マイナンバー",
    // 12桁(4桁ずつの区切りも)。検査の数字が合う物だけ(合わない 12桁は ID や時刻のことが多い)
    pattern: /(?<![\w.-])\d{4}(-?)\d{4}\1\d{4}(?![\w-]|\.\d)/g,
    allowed: (value) => !isMyNumber(value) || allowedDigits(value),
  },
  {
    kind: "郵便番号(〒)",
    pattern: /〒\s*\d{3}-?\d{4}(?!\d)/g,
    allowed: () => false,
  },
];

const digitsOf = (value) => value.replace(/\D/g, "");

function allowedDigits(value) {
  const digits = digitsOf(value);
  return ALLOWED_DIGITS.some((a) => a.digits === digits);
}

// 日本の番号は 0 を入れて 10〜11桁(+81 は 0 の代わり)
function phoneLength(value) {
  const digits = digitsOf(value.replace(/^\+81-?/, "0"));
  return digits.length === 10 || digits.length === 11;
}

/** 許すメールアドレスか(予約のドメイン・届かない宛先) */
export function allowedEmail(value) {
  const address = value.toLowerCase();
  if (ALLOWED_EMAILS.some((a) => a.address === address)) return true;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return ALLOWED_EMAIL_DOMAINS.some((a) => domain === a.domain || domain.endsWith(`.${a.domain}`));
}

/**
 * マイナンバーの検査の数字が合うか(行政手続における特定の個人を識別するための番号の利用等に関する法律施行令の8条の式)。
 * 下から n 桁目(検査の数字を除く)を Pn、重みを Qn(n が 1〜6 は n+1、7〜11 は n−5)として、
 * 余り = ΣPn×Qn を 11 で割った余り。検査の数字 = 余りが 0・1 なら 0、それ以外は 11 − 余り
 */
export function isMyNumber(value) {
  const digits = digitsOf(value);
  if (!/^\d{12}$/.test(digits)) return false;
  let sum = 0;
  for (let n = 1; n <= 11; n++) {
    sum += Number(digits[11 - n]) * (n <= 6 ? n + 1 : n - 5);
  }
  const rest = sum % 11;
  return Number(digits[11]) === (rest <= 1 ? 0 : 11 - rest);
}

/** ログに出す形。値は出さず、形が分かるだけにする(メールは頭の1文字と終わりのドメイン、数字は頭の2桁だけ) */
export function mask(kind, value) {
  if (kind === "メールアドレス") {
    const tld = value.slice(value.lastIndexOf(".") + 1);
    return `${value[0]}***@***.${tld}`;
  }
  let shown = 0;
  return value.replace(/\d/g, (d) => (shown++ < 2 ? d : "*"));
}

/** 1つの文の中の当たり。{ kind, line, column, masked }(行・列は 1 から)。同じ所に重ねて当てない */
export function findPii(text) {
  const source = narrow(String(text ?? ""));
  const hits = [];
  const taken = [];
  for (const rule of RULES) {
    for (const m of source.matchAll(rule.pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && s < end)) continue;
      const allowed = rule.allowed(m[0]);
      // 許したメールアドレスの中(09012345678@example.com の数字)も、ほかの形で当てない
      if (!allowed || rule.kind === "メールアドレス") taken.push([start, end]);
      if (allowed) continue;
      hits.push({ kind: rule.kind, ...positionOf(source, start), masked: mask(rule.kind, m[0]) });
    }
  }
  return hits.sort((a, b) => a.line - b.line || a.column - b.column);
}

function positionOf(text, index) {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

/** いくつかの文を見る。texts: [{ where: "PR の本文" など, text }]。当たり: { where, kind, line, column, masked } */
export function scanTexts(texts) {
  return texts.flatMap(({ where, text }) => findPii(text).map((hit) => ({ where, ...hit })));
}

/**
 * 上流のリリースノート・脆弱性の説明を PR の本文に写すボット。本文は上流で公開済みの文で、攻撃の例の宛先
 * (a@evil.com など)がよく入る。止めると依存の更新(セキュリティの直しも)が止まるので、本文だけ見ない。題名とコミットの文は見る
 */
export const UPSTREAM_BOTS = new Set(["renovate[bot]", "dependabot[bot]"]);

/** PR の見る文。pull: GitHub の PR(title・body・user)、commits: PR のコミット(sha・commit.message) */
export function prTexts({ pull, commits }) {
  const upstream = pull.user?.type === "Bot" && UPSTREAM_BOTS.has(pull.user.login);
  return [
    { where: "PR の題名", text: pull.title },
    ...(upstream ? [] : [{ where: "PR の本文", text: pull.body }]),
    ...commits.map((c) => ({
      where: `コミット ${String(c.sha).slice(0, 7)} の文`,
      text: c.commit?.message,
    })),
  ];
}

/** 当たりを、ログに出す行にする(値は伏せた形だけ) */
export const hitLines = (hits) =>
  hits.map((h) => `${h.where} の ${h.line}行目 ${h.column}文字目: ${h.kind}(${h.masked})`);
