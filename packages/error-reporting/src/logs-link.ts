// Sentry の1件から、そのリクエストのログ(CloudWatch Logs Insights)を1クリックで開くリンク。
// コンソールの URL は、検索の中身を独特の形(~( … ) と * / $ の置き換え)で埋め込む。

export type LogsLinkOptions = {
  /** ap-northeast-1 など */
  region: string;
  /** 探すロググループ(API と画面のサーバー) */
  logGroups: string[];
};

/** requestId の前後15分の、そのリクエストの全部の行を引くクエリ。 */
export function requestQuery(requestId: string): string {
  return [
    "fields @timestamp, service, level, message, method, route, path, status, durationMs, err.type, err.message",
    `| filter requestId = "${requestId.replace(/[^A-Za-z0-9-]/g, "")}"`,
    "| sort @timestamp asc",
  ].join("\n");
}

// コンソールと同じ形: %2F → *2f(小文字)
const inner = (s: string) =>
  encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_m, hex: string) => `*${hex.toLowerCase()}`);

export function logsInsightsUrl(
  opts: LogsLinkOptions,
  requestId: string,
  at: Date,
  marginMinutes = 15,
): string {
  const start = new Date(at.getTime() - marginMinutes * 60_000).toISOString();
  const end = new Date(at.getTime() + marginMinutes * 60_000).toISOString();
  const sources = opts.logGroups.map((g) => `~'${inner(g)}`).join("");
  const detail =
    `~(end~'${inner(end)}~start~'${inner(start)}~timeType~'ABSOLUTE~tz~'UTC` +
    `~editorString~'${inner(requestQuery(requestId))}~source~(${sources}))`;
  const fragment = encodeURIComponent(`?queryDetail=${detail}`).replace(/%/g, "$");
  const host = `${opts.region}.console.aws.amazon.com`;
  return `https://${host}/cloudwatch/home?region=${opts.region}#logsV2:logs-insights${fragment}`;
}

/** Sentry からログを開くリンクの設定(どちらかが無ければ付けない)。画面のサーバーも同じ環境変数。 */
export function logsLinkFrom(
  region: string | undefined,
  groups: string | undefined,
): LogsLinkOptions | undefined {
  const logGroups = (groups ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  return region && logGroups.length > 0 ? { region, logGroups } : undefined;
}
