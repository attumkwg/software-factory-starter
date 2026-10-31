import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALLOWED_DIGITS,
  ALLOWED_EMAIL_DOMAINS,
  ALLOWED_EMAILS,
  allowedEmail,
  findPii,
  hitLines,
  isMyNumber,
  mask,
  prTexts,
  scanTexts,
} from "./text-pii-lib.mjs";

const kinds = (text) => findPii(text).map((h) => h.kind);

// 検査の数字を式で付ける(テストの中で本物らしい値を書き並べない)
function withCheckDigit(eleven) {
  let sum = 0;
  for (let n = 1; n <= 11; n++) sum += Number(eleven[11 - n]) * (n <= 6 ? n + 1 : n - 5);
  const rest = sum % 11;
  return `${eleven}${rest <= 1 ? 0 : 11 - rest}`;
}
const VALID_MY_NUMBER = withCheckDigit("12345678901");

test("当たるべき物: 許さないドメインのメールアドレス", () => {
  assert.deepEqual(kinds("連絡は taro.yamada@gmail.com まで"), ["メールアドレス"]);
  assert.deepEqual(kinds("<hanako+ci@corp.co.jp>"), ["メールアドレス"]);
  assert.deepEqual(kinds("mailto:a@b.io"), ["メールアドレス"]);
  // 例の名前に似ていても、予約のドメインの下でなければ当てる
  assert.deepEqual(kinds("x@example.co.jp・y@notexample.com・z@example.com.evil.io"), [
    "メールアドレス",
    "メールアドレス",
    "メールアドレス",
  ]);
  // anthropic.com は宛先の1つだけを許す(ドメインの全部は許さない)
  assert.deepEqual(kinds("someone@anthropic.com"), ["メールアドレス"]);
});

test("当たるべき物: 電話番号(区切りあり・区切りなしの携帯)", () => {
  for (const t of [
    "tel 03-1234-5678",
    "090-1234-5678 にどうぞ",
    "0120-123-456",
    "+81-90-1234-5678",
    "+8190-1234-5678",
    "電話は08012345678です",
    "050-1234-5678",
    "０９０－１２３４－５６７８",
  ])
    assert.deepEqual(kinds(t), ["電話番号"], t);
});

test("当たるべき物: 検査の数字が合う 12桁(マイナンバー)と、〒つきの郵便番号", () => {
  assert.equal(isMyNumber(VALID_MY_NUMBER), true);
  assert.deepEqual(kinds(`番号 ${VALID_MY_NUMBER}`), ["マイナンバー"]);
  const spaced = `${VALID_MY_NUMBER.slice(0, 4)}-${VALID_MY_NUMBER.slice(4, 8)}-${VALID_MY_NUMBER.slice(8)}`;
  assert.deepEqual(kinds(spaced), ["マイナンバー"]);
  assert.deepEqual(kinds("〒141-0022 東京都品川区"), ["郵便番号(〒)"]);
  assert.deepEqual(kinds("〒 1410022"), ["郵便番号(〒)"]);
  assert.deepEqual(kinds("〒１４１－００２２"), ["郵便番号(〒)"]);
});

test("当たってはいけない物: 検査の数字が合わない 12桁・長い数字・ID・時刻", () => {
  const wrong = `${VALID_MY_NUMBER.slice(0, 11)}${(Number(VALID_MY_NUMBER[11]) + 1) % 10}`;
  assert.equal(isMyNumber(wrong), false);
  assert.equal(isMyNumber("12345"), false);
  for (const t of [
    `番号 ${wrong}`,
    "AWS のアカウント 123456789012",
    "1234567890123(13桁)",
    "id=3d3c42e5aac5ba805825da76410c181273ba90b1",
    "2026-10-31 12:00",
    "v1.2.3・2026-10-31T00:00:00Z",
    "550e8400-e29b-41d4-a716-446655440000",
    "郵便番号 141-0022(〒が無い)",
  ])
    assert.deepEqual(kinds(t), [], t);
});

test("当たってはいけない物: コミットの末尾・予約のドメイン・GitHub の届かない宛先", () => {
  for (const t of [
    "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    "Co-authored-by: someone <12345+someone@users.noreply.github.com>",
    "taro@example.com・hanako@sub.example.org・x@example.net",
    "admin@acme.test・Owner@Corp.TEST・a@evil.example・b@nowhere.invalid・c@app.localhost",
    "既定の送り元 no-reply@verificationemail.com",
    // メールではない @
    "pnpm@10.34.7・actions/checkout@3d3c42e5aac5・@app/logging・@attumkwg",
    // URL の中の認証の部分(Sentry の DSN の形)
    "https://key@o1.ingest.sentry.io/123",
  ])
    assert.deepEqual(kinds(t), [], t);
  // 許したメールアドレスの中の数字も、電話番号として当てない
  assert.deepEqual(kinds("09012345678@example.com"), []);
});

test("当たってはいけない物: このリポジトリのテストの偽の値", () => {
  for (const t of [
    'const PHONE = "090-0000-0000";',
    "550 <taro@example.com> 09000000000",
    "tel 090-0000-0000 / 03 1234 5678",
  ])
    assert.deepEqual(kinds(t), [], t);
});

test("許す一覧は、全部に理由がある", () => {
  for (const a of [...ALLOWED_EMAIL_DOMAINS, ...ALLOWED_EMAILS, ...ALLOWED_DIGITS])
    assert.ok(String(a.why ?? "").length > 0, JSON.stringify(a));
  assert.equal(allowedEmail("NoReply@Anthropic.com"), true);
  assert.equal(allowedEmail("noreply@anthropic.com.evil.io"), false);
});

test("場所は行と列で、値はログに出さない(伏せた形だけ)", () => {
  const hits = findPii("1行目\n  連絡: taro@gmail.com\n電話 090-1234-5678");
  assert.deepEqual(
    hits.map(({ kind, line, column }) => ({ kind, line, column })),
    [
      { kind: "メールアドレス", line: 2, column: 7 },
      { kind: "電話番号", line: 3, column: 4 },
    ],
  );
  const lines = hitLines(scanTexts([{ where: "PR の本文", text: "taro@gmail.com 090-1234-5678" }]));
  assert.equal(lines.length, 2);
  for (const l of lines) {
    assert.ok(l.startsWith("PR の本文 の 1行目"), l);
    assert.ok(!l.includes("taro") && !l.includes("1234") && !l.includes("5678"), l);
  }
  assert.equal(mask("メールアドレス", "taro@gmail.com"), "t***@***.com");
  assert.equal(mask("電話番号", "090-1234-5678"), "09*-****-****");
  assert.equal(mask("マイナンバー", VALID_MY_NUMBER), "12**********");
});

test("PR の見る文: 題名・本文・コミットの文。上流の文を写すボットは本文だけ見ない", () => {
  const commits = [{ sha: "abcdef0123456", commit: { message: "直す\n\nCo-Authored-By: x" } }];
  const human = prTexts({
    pull: { title: "題名", body: "本文", user: { login: "someone", type: "User" } },
    commits,
  });
  assert.deepEqual(
    human.map((t) => t.where),
    ["PR の題名", "PR の本文", "コミット abcdef0 の文"],
  );
  const bot = prTexts({
    pull: { title: "Update x", body: "a@evil.com", user: { login: "renovate[bot]", type: "Bot" } },
    commits,
  });
  assert.deepEqual(
    bot.map((t) => t.where),
    ["PR の題名", "コミット abcdef0 の文"],
  );
  // ボットの名前を名乗る人のアカウントの本文は見る
  const fake = prTexts({
    pull: { title: "t", body: "b", user: { login: "renovate[bot]", type: "User" } },
    commits: [],
  });
  assert.ok(fake.some((t) => t.where === "PR の本文"));
  // 本文が空(null)でも落ちない
  assert.deepEqual(scanTexts(prTexts({ pull: { title: "t", body: null }, commits: [] })), []);
});
