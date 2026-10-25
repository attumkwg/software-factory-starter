// 公開のページの設定(docs/specs/0025-public-landing-page.md)。ビルドのときに環境変数から決め、HTML と JS に焼き込む。
// 秘密は無い(どれも公開の URL)。.env は読まない(vite.config.ts の envDir: false)。
//   SITE_ENV … prod のときだけ検索に載せる。それ以外(stg・preview・local)は全部 noindex・robots.txt で全部お断り
//   SITE_URL … このページの URL(canonical・サイトマップ・確認のメールのリンクの頭 = API の PUBLIC_SITE_URL と同じ)
//   APP_URL  … 画面と API の URL(事前登録の送り先 /api/public/*・プライバシーポリシー /legal/privacy)

export const SITE_ENVS = ["local", "preview", "stg", "prod"] as const;
export type SiteEnv = (typeof SITE_ENVS)[number];

export type SiteConfig = {
  env: SiteEnv;
  siteUrl: string;
  appUrl: string;
  /** 検索に載せるか(prod だけ) */
  indexable: boolean;
};

const LOCAL = { siteUrl: "http://localhost:5190", appUrl: "http://localhost:8080" };

/** 環境変数から設定を作る。本物の環境(stg・prod)では URL が要り、https・最後に / なし */
export function siteConfigFrom(env: Record<string, string | undefined>): SiteConfig {
  const siteEnv = (env.SITE_ENV ?? "local") as SiteEnv;
  if (!SITE_ENVS.includes(siteEnv)) throw new Error(`SITE_ENV が正しくありません: ${siteEnv}`);
  const deployed = siteEnv === "stg" || siteEnv === "prod";
  const pick = (key: "SITE_URL" | "APP_URL", fallback: string) => {
    const value = env[key];
    if (!value) {
      if (deployed) throw new Error(`${siteEnv} では ${key} が要ります`);
      return fallback;
    }
    if (deployed && !value.startsWith("https://"))
      throw new Error(`${key} は https:// にしてください`);
    if (value.endsWith("/")) throw new Error(`${key} の最後に / を付けないでください`);
    return value;
  };
  return {
    env: siteEnv,
    siteUrl: pick("SITE_URL", LOCAL.siteUrl),
    appUrl: pick("APP_URL", LOCAL.appUrl),
    indexable: siteEnv === "prod",
  };
}
