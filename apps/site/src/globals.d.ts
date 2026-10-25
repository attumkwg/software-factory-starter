import type { SiteConfig } from "./config.ts";

declare global {
  /** ビルドのときに焼き込む設定(vite.config.ts の define) */
  const __SITE_CONFIG__: SiteConfig;
}
