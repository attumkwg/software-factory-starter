import { scrubText } from "./scrub-text.ts";

// ログの1行に出してよい項目(許可リスト。docs/specs/0008-personal-data.md の B・ADR 0019)。
//
// 決まり: **出してよいと決めた名前だけを出す。知らない名前は値を [REDACTED] にする。**
//   - 名前が `…Id` / `…Ids` の物(requestId・taskId など)と、下の ALLOWED_KEYS だけ
//   - ALWAYS_REDACTED の名前は、どの深さにあっても伏せる(許可リストより強い)
//   - 出してよい名前でも、文字列の値は伏せ字(scrubText)を通す。ID は ID の形の物だけ
// 足すときは、値が利用者の入れた物・個人の情報にならない名前だけ(ID・決まった文字列・数・時間)。

/** 出してよい名前(`…Id` / `…Ids` のほかに)。足すときは人の確認が要る(危険度「高」) */
// 失敗(`err`)は許可リストではなく、serializeError を通した形で出す(logger.ts)。
export const ALLOWED_KEYS: readonly string[] = [
  // API の失敗の種類・どの API か(ID を入れる前の形)・アクセスログ
  "code",
  "route",
  "method",
  "path",
  "status",
  "durationMs",
  // 数・回数・時間
  "count",
  "rows",
  "attempts",
  "timeoutMs",
  // コードが決めた文字列(利用者の入れた物ではない)
  "topic",
  "what",
  "reason",
  "kind",
  "hasVerifiedEmail",
  "signal",
  "sql",
  // 起動のときの設定
  "service",
  "port",
  "appEnv",
  "authMode",
  "apiInternalUrl",
];

/**
 * どの深さにあっても伏せる名前。比べるときは大文字・小文字と `_` を無視する(staff_name = staffName)。
 * 列の分類表(apps/api/src/db/classification.ts)の personal / sensitive の列の名前を全部含む
 * (足りないと apps/api/test/unit/classification.test.ts が落ちる)。
 */
export const ALWAYS_REDACTED: readonly string[] = [
  // 秘密
  "password",
  "secret",
  "token",
  "idToken",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  // 個人情報(分類表の personal / sensitive)
  "email",
  "name",
  "title",
  "staffName",
  "staffEmail",
  "previousEmail",
  "newEmail",
];

export const REDACTED = "[REDACTED]";

const normalize = (key: string) => key.replace(/_/g, "").toLowerCase();
const DENIED = new Set(ALWAYS_REDACTED.map(normalize));
const ALLOWED = new Set(ALLOWED_KEYS);
const ID_KEY = /^[a-z][A-Za-z]*Ids?$/;
/** ID の形(UUID・request ID・trace ID・出来事の名前)。メールアドレスや日本語の名前は通らない */
const ID_VALUE = /^[\w.:-]{1,100}$/;
/** メールの Message-ID(<task-completed.<出来事の ID>@<アプリのホスト>>。中身はこちらが決めた物だけ) */
const MESSAGE_ID_VALUE = /^<[\w.-]{1,150}@[\w.-]{1,100}>$/;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
/** パスの1区切りとして残してよい形(英字の名前)。それ以外(数字の並び・日本語・記号)は伏せる */
const PATH_WORD = /^[A-Za-z_.-]{1,64}$/;
const MAX_DEPTH = 4;

export const isDeniedKey = (key: string): boolean => DENIED.has(normalize(key));
export const isAllowedKey = (key: string): boolean =>
  !isDeniedKey(key) && (ALLOWED.has(key) || ID_KEY.test(key));

/** パスは ID と英字の名前の区切りだけ残す(`/api/projects/<ID>` は残る・`/api/田中` は伏せる) */
export function scrubPath(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg === "" || UUID.test(seg) || PATH_WORD.test(seg) ? seg : "[…]"))
    .join("/");
}

function idValue(key: string, value: string): string {
  if (key === "messageId" && MESSAGE_ID_VALUE.test(value)) return value;
  return ID_VALUE.test(value) ? value : REDACTED;
}

function scalar(key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (ID_KEY.test(key)) return idValue(key, value);
  if (key === "path") return scrubPath(value);
  return scrubText(value, 1000);
}

function sanitizeValue(key: string, value: unknown, depth: number): unknown {
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(key, v, depth));
  if (value !== null && typeof value === "object") {
    return depth >= MAX_DEPTH
      ? REDACTED
      : sanitizeFields(value as Record<string, unknown>, depth + 1);
  }
  return scalar(key, value);
}

/** ログの1行の項目を、許可リストで絞る(知らない名前・伏せる名前は値を [REDACTED] に)。 */
export function sanitizeFields(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = isAllowedKey(key) ? sanitizeValue(key, value, depth) : REDACTED;
  }
  return out;
}
