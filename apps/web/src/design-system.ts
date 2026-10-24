// 部品の一覧ページ(/design-system)を出すか。利用者に見せる画面ではないので、本番(APP_ENV=prod)では出さない。
// 手元・テスト・プレビュー・stg では、ログイン無しで開ける(docs/designs/0011-visual-regression.md)
export function designSystemVisible(appEnv: string | undefined): boolean {
  return appEnv !== "prod";
}
