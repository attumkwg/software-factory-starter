// 見た目の回帰テストで撮る画面(docs/designs/0011-visual-regression.md の 5.3)。
// 足すときは1行足して `pnpm vrt:update` → 画像をコミット。消すときは __screenshots__ の画像も消す。
// 写してよいのは種データ(架空の2社・.test のメール)と固定の文だけ。日付は screens.spec.ts で塗る。
// ログインの後ろの画面は Globex の管理者で撮る(E2E は Acme に書き込むので、E2E の後に撮ると一覧が変わる)。
// 撮らない画面: 監査ログ(行と時刻が増える)・アカウント・登録・パスワードの再設定(Cognito のときだけ出る)・サポート(二段階認証が必須)・同意(戻れない)

export type Screen = {
  /** 画像の名前(<id>.png) */
  id: string;
  /** PR のコメントに出す名前 */
  label: string;
  path: string;
  /** 開いたら出るのを待つ見出し(level 1) */
  heading: string;
  /** ログインしてから開くときの人(種データ) */
  as?: string;
};

export const GLOBEX_ADMIN = "admin@globex.test";
const GLOBEX_PROJECT_ID = "0199a000-0000-7000-8000-00000000b101";

export const SCREENS: Screen[] = [
  { id: "login", label: "ログイン", path: "/login", heading: "ログイン" },
  { id: "legal-terms", label: "利用規約", path: "/legal/terms", heading: "利用規約" },
  { id: "not-found", label: "見つからない", path: "/no-such", heading: "ページが見つかりません" },
  { id: "design-system", label: "部品の一覧", path: "/design-system", heading: "部品の一覧" },
  {
    id: "projects",
    label: "プロジェクトの一覧",
    path: "/",
    heading: "プロジェクト",
    as: GLOBEX_ADMIN,
  },
  {
    id: "tasks",
    label: "タスク",
    path: `/projects/${GLOBEX_PROJECT_ID}`,
    heading: "Globex の秘密の計画",
    as: GLOBEX_ADMIN,
  },
  { id: "settings", label: "設定", path: "/settings", heading: "設定", as: GLOBEX_ADMIN },
  {
    id: "support-access",
    label: "サポートへの許可",
    path: "/support-access",
    heading: "サポートへの許可",
    as: GLOBEX_ADMIN,
  },
];

/** 画面の中を操作してから撮る物(SCREENS の画面の続き) */
export const EXTRA_SHOTS: { id: string; label: string }[] = [
  { id: "design-system-dialog", label: "部品の一覧(確認のダイアログ)" },
];
