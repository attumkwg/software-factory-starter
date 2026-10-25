import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./App.tsx";
import { type SiteConfig, siteConfigFrom } from "./config.ts";
import { headFor, PAGE_PATHS, PAGES, type PageName, robotsTxt, sitemapXml } from "./head.ts";

// ビルドのとき(scripts/prerender.mjs)に、ページごとの HTML を作る入口。

export { PAGE_PATHS, PAGES, robotsTxt, siteConfigFrom, sitemapXml };

export function render(page: PageName, config: SiteConfig): { head: string; html: string } {
  return {
    head: headFor(page, config),
    html: renderToString(
      <StrictMode>
        <App page={page} config={config} />
      </StrictMode>,
    ),
  };
}
