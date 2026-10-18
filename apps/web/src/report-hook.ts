// SSR の中(src/start.ts)から、画面のサーバー(server/index.ts)の「Sentry に送る」入口を呼ぶための受け渡し。
// SSR の束(vite)と画面のサーバーの束(esbuild)は別のモジュールなので、globalThis に置く。

export type ReportError = (line: Record<string, unknown>) => void;

const KEY = Symbol.for("app.web.reportError");
const slot = globalThis as { [KEY]?: ReportError | undefined };

export function setReportError(report: ReportError | undefined) {
  slot[KEY] = report;
}

export function reportError(line: Record<string, unknown>) {
  slot[KEY]?.(line);
}
