// Sentry に送る前に、値を落とす(サーバーとブラウザの両方で使う。Sentry には依存しない)。
//
// 決まり: **Sentry に送るのは、ログに出した error 以上のものだけ・ログより少ない中身だけ。**
//   - ログの1行から、決めた項目だけを拾う(ログに足した項目が、知らないうちに外へ出ないように)
//   - 失敗の文(message)からは、値になりうるもの(メールアドレス・長い数字・引用符の中・key=value・URL の ? 以降)を伏せる
// Sentry は外の会社なので、ログ(自分の AWS の中)より一段きつく絞る。

/** 引用符の中でも残すもの: 識別子らしい短い名前(「reading 'title'」の title など) */
const IDENTIFIER = /^[A-Za-z_$][\w$.-]{0,63}$/;

const RULES: [RegExp, (substring: string, ...groups: string[]) => string][] = [
  // メールアドレス
  [/[^\s"'`<>()[\]{},;:]+@[^\s"'`<>()[\]{},;:]+\.[A-Za-z]{2,}/g, () => "[email]"],
  // URL の ? 以降(検索の値・トークン)
  [/(https?:\/\/[^\s?"'`]+)\?[^\s"'`]*/g, (_m, base) => `${base}?[…]`],
  // key=value / key: value の値(password=…・token: … など)
  [
    /\b(password|passwd|secret|token|api[_-]?key|authorization|cookie|session)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
    (_m, key, sep) => `${key}${sep}[…]`,
  ],
  // 引用符の中(識別子らしい短い名前は残す)
  [/"([^"]*)"|'([^']*)'|`([^`]*)`/g, quoted],
  // 6桁以上の数字(電話・カード・ID の値)
  [/\d{6,}/g, () => "[数字]"],
];

function quoted(match: string, ...groups: string[]): string {
  const inner = groups.slice(0, 3).find((g) => g !== undefined) ?? "";
  if (IDENTIFIER.test(inner)) return match;
  const q = match[0];
  return `${q}[…]${q}`;
}

/** 失敗の文から値を伏せる。長すぎる文は切る。 */
export function scrubMessage(message: string, maxLength = 500): string {
  let out = message;
  for (const [pattern, replace] of RULES) out = out.replace(pattern, replace);
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

/** ログの1行のうち、Sentry に送ってよい項目(これ以外は送らない)。 */
// 足すときは、値(利用者が入れた物・個人の情報)にならない物だけ。ID・決まった文字列・道すじの形まで。
export type ReportLine = {
  level: "error" | "fatal";
  /** ログの文(コードに書いた固定の文。値は入らない決まり) */
  message: string | undefined;
  service: string | undefined;
  requestId: string | undefined;
  tenantId: string | undefined;
  /** users の ID(メールアドレスではない)。Sentry が「何人が困ったか」を数える */
  userId: string | undefined;
  traceId: string | undefined;
  /** API の失敗の種類(internal・service_unavailable など) */
  code: string | undefined;
  /** どの API か(例 "POST /api/projects/:projectId/tasks"。ID を入れる前の形なので値は入らない) */
  route: string | undefined;
  err:
    | { type: string; message: string; stack: string | undefined; code: string | undefined }
    | undefined;
};

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;

/** ログの1行(JSON を読んだもの)から、送ってよい項目だけを拾う。error 未満なら null。 */
export function pickReportLine(line: Record<string, unknown>): ReportLine | null {
  const level = line.level === "fatal" ? "fatal" : line.level === "error" ? "error" : null;
  if (!level) return null;
  const rawErr =
    line.err && typeof line.err === "object" ? (line.err as Record<string, unknown>) : null;
  return {
    level,
    message: line.message === undefined ? undefined : scrubMessage(String(line.message), 200),
    service: str(line.service, 40),
    requestId: str(line.requestId, 64),
    tenantId: str(line.tenantId, 64),
    userId: str(line.userId, 64),
    traceId: str(line.traceId, 64),
    code: str(line.code, 64),
    route: str(line.route, 200),
    err: rawErr
      ? {
          type: str(rawErr.type, 100) ?? "Error",
          message: scrubMessage(str(rawErr.message, 2000) ?? ""),
          // スタックは「at 関数 (ファイル:行:列)」だけ(1行目の文は捨てる)
          stack: str(rawErr.stack, 8000)
            ?.split("\n")
            .filter((l) => l.trimStart().startsWith("at "))
            .join("\n"),
          code: str(rawErr.code, 40),
        }
      : undefined,
  };
}
