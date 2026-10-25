// 営業のデモ用の組織(docs/specs/0053-sales-kit.md)の入口。運営のコマンド demo-reset(cli.ts)が使う。
export {
  DEMO_DATA,
  DEMO_RESET_TABLES,
  type DemoResetResult,
  demoReset,
  demoTarget,
  resetDemo,
  runDemoReset,
} from "./reset.ts";
