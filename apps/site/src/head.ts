import type { SiteConfig } from "./config.ts";
import { CONTENT } from "./content.ts";

// ページごとの <head> の中身と、robots.txt・sitemap.xml(docs/designs/0025-public-landing-page.md の 6)。
// 検索に載せるのは prod の LP だけ。確認・取り消しのページは、どの環境でも載せない。

export const PAGES = ["landing", "confirm", "withdraw"] as const;
export type PageName = (typeof PAGES)[number];

/** ページの置き場所(dist の中のパス・URL の path) */
export const PAGE_PATHS: Record<PageName, string> = {
  landing: "/",
  confirm: "/confirm/",
  withdraw: "/withdraw/",
};

const TITLES: Record<PageName, string> = {
  landing: `${CONTENT.productName} | ${CONTENT.hero.title}`,
  confirm: `事前登録の確認 | ${CONTENT.productName}`,
  withdraw: `事前登録を消す | ${CONTENT.productName}`,
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function indexable(page: PageName, config: SiteConfig): boolean {
  return config.indexable && page === "landing";
}

export function headFor(page: PageName, config: SiteConfig): string {
  const url = `${config.siteUrl}${PAGE_PATHS[page]}`;
  const lines = [
    `<title>${escapeHtml(TITLES[page])}</title>`,
    `<meta name="description" content="${escapeHtml(CONTENT.description)}" />`,
    indexable(page, config)
      ? `<link rel="canonical" href="${escapeHtml(url)}" />`
      : `<meta name="robots" content="noindex, nofollow" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(TITLES[page])}" />`,
    `<meta property="og:description" content="${escapeHtml(CONTENT.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    // どこから来たかを、ほかのサイトへ渡さない(外へ送らない)
    `<meta name="referrer" content="strict-origin-when-cross-origin" />`,
  ];
  return lines.join("\n    ");
}

export function robotsTxt(config: SiteConfig): string {
  if (!config.indexable) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nDisallow: /confirm/\nDisallow: /withdraw/\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`;
}

/** 検索に載せるページだけ。prod 以外は null(置かない) */
export function sitemapXml(config: SiteConfig): string | null {
  if (!config.indexable) return null;
  const urls = PAGES.filter((p) => indexable(p, config)).map(
    (p) => `  <url><loc>${escapeHtml(`${config.siteUrl}${PAGE_PATHS[p]}`)}</loc></url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
