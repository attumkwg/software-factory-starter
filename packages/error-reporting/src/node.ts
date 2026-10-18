import { Writable } from "node:stream";
import * as Sentry from "@sentry/node";
import { pickReportLine, type ReportLine } from "./scrub.ts";

export { pickReportLine, type ReportLine, scrubMessage } from "./scrub.ts";

// サーバー(API・画面のサーバー)の失敗を Sentry に送る。
//
// **ログの error 以上の行を、そのまま Sentry の1件にする**(ロガーの出口を1つ増やすだけ)。
//   - どこで失敗しても、ログに error で残せば Sentry にも届く(送り忘れが無い)
//   - 送る中身はログの1行から拾った決めた項目だけ(scrub.ts)。リクエストの本文・Cookie・ヘッダーは送らない
//   - Sentry の自動の仕組み(リクエストの記録・パンくず・ローカル変数・トレース)は全部切る
// SENTRY_DSN が無ければ何もしない(手元・テスト・プレビュー)。

/** Sentry が自動で集める物を全部切る(画面のブラウザ側 apps/web/src/report-error.ts も同じ) */
export const NO_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
} satisfies Sentry.NodeOptions["dataCollection"];

export type ErrorReporter = {
  /** pino の出口(level: "error" で足す) */
  stream: Writable;
  /** ログの1行(JSON を読んだもの)を送る。error 未満は捨てる */
  report(line: Record<string, unknown>): void;
  /** 送り終わるのを待つ(止まる前に呼ぶ) */
  flush(timeoutMs: number): Promise<void>;
};

export type ErrorReporterOptions = {
  dsn: string | undefined;
  /** local / stg / prod など(Sentry の environment) */
  environment: string;
  /** api / web(Sentry の server_name。ホスト名は送らない) */
  service: string;
  release?: string | undefined;
  /** 1分に送る上限(DB の再起動などで同じ失敗が大量に出ても、Sentry の枠を使い切らない) */
  maxPerMinute?: number;
  /** 同じ失敗(種類+文)を1分に送る上限 */
  maxSamePerMinute?: number;
  /** テスト用: 送り先を差し替える */
  transport?: Sentry.NodeOptions["transport"];
};

export function createErrorReporter(opts: ErrorReporterOptions): ErrorReporter | null {
  if (!opts.dsn) return null;
  Sentry.initWithoutDefaultIntegrations({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    serverName: opts.service,
    integrations: [],
    // v11 は既定で「ヘッダー・Cookie・本文・利用者」を集める。全部切る(送るのは toEvent で作った物だけ)
    dataCollection: NO_DATA_COLLECTION,
    enableRuntimeChannelInjection: false,
    tracesSampleRate: 0,
    ...(opts.transport ? { transport: opts.transport } : {}),
  });

  const limit = createLimiter(opts.maxPerMinute ?? 30, opts.maxSamePerMinute ?? 3);

  function report(raw: Record<string, unknown>) {
    const line = pickReportLine(raw);
    if (!line) return;
    if (!limit(`${line.err?.type}|${line.err?.message ?? line.message}`)) return;
    Sentry.captureEvent(toEvent(line));
  }

  const stream = new Writable({
    write(chunk, _enc, cb) {
      try {
        report(JSON.parse(chunk.toString()));
      } catch {
        // 送れなくてもアプリは止めない(元のログは標準出力に出ている)
      }
      cb();
    },
  });

  return {
    stream,
    report,
    flush: async (timeoutMs) => {
      await Sentry.flush(timeoutMs);
    },
  };
}

function toEvent(line: ReportLine): Sentry.Event {
  const tags: Record<string, string> = {};
  for (const key of ["service", "requestId", "tenantId", "traceId", "code"] as const) {
    const v = line[key];
    if (v) tags[key] = v;
  }
  if (line.err?.code) tags.errCode = line.err.code;
  return {
    level: line.level,
    tags,
    ...(line.err
      ? {
          exception: {
            values: [
              {
                type: line.err.type,
                value: line.err.message,
                stacktrace: line.err.stack
                  ? { frames: Sentry.defaultStackParser(line.err.stack) }
                  : undefined,
              },
            ],
          },
          // ログの文は、どこで受け止めたかの手がかり
          extra: { logMessage: line.message },
        }
      : { message: line.message ?? "(文の無いログ)" }),
  };
}

/** 1分ごとに数え直す、簡単な上限。 */
function createLimiter(max: number, maxSame: number) {
  let windowStart = 0;
  let total = 0;
  const perKey = new Map<string, number>();
  return (key: string) => {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      total = 0;
      perKey.clear();
    }
    const same = perKey.get(key) ?? 0;
    if (total >= max || same >= maxSame) return false;
    total += 1;
    perKey.set(key, same + 1);
    return true;
  };
}
