// @sentry/browser のうち、使う物だけ(report-error.ts が DSN のあるときだけ後から読み込む)。
// 丸ごと import() すると、使わない機能(画面の録画など)まで入って 140KB(gzip)になる。
export {
  captureException,
  dedupeIntegration,
  globalHandlersIntegration,
  init,
  linkedErrorsIntegration,
} from "@sentry/browser";
