// 公開の LP の事前登録の入口とコマンド(docs/specs/0025-public-landing-page.md)。運営の組織の文脈(withTenant)を開く所だけ。
// 表と読み書きは領域 domains/growth(ここからは index.ts だけを使う)。
export {
  runDelete as runPreRegistrationDelete,
  runPurge as runPreRegistrationPurge,
  runReport as runPreRegistrationReport,
} from "./command.ts";
export { type PublicGrowthDeps, publicGrowthRoutes } from "./routes.ts";
