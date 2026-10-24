// 利用の記録(共通の仕組み。docs/specs/0012-feature-flags-and-usage.md)の入口。
// 機能の API のハンドラーは recordUsage を呼ぶ。集計と保存期間の削除は運営のコマンド(cli.ts)。
export {
  parseUsageReportArgs,
  purgeUsage,
  runUsagePurge,
  runUsageReport,
  USAGE_RETENTION_DAYS,
  type UsageReport,
  type UsageWeek,
  usageReport,
} from "./command.ts";
export { recordUsage } from "./repository.ts";
