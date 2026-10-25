// ページごとの静的な HTML を作る(vite build の後)。dist/index.html(JS と CSS の読み込みが入った型)に、
// サーバーで描いた中身と <head> を入れ、dist/<ページ>/index.html に書く。robots.txt・sitemap.xml も作る。
// 設定はビルドのときの環境変数(SITE_ENV・SITE_URL・APP_URL。src/config.ts)。
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const ssr = join(root, "dist-ssr");

const { render, PAGES, PAGE_PATHS, robotsTxt, sitemapXml, siteConfigFrom } = await import(
  pathToFileURL(join(ssr, "entry-server.js")).href
);
const config = siteConfigFrom(process.env);
const template = await readFile(join(dist, "index.html"), "utf8");

for (const page of PAGES) {
  const { head, html } = render(page, config);
  const out = template
    .replace("<!--head-->", head)
    .replace("<!--app-->", html)
    .replace("<body>", `<body data-page="${page}">`);
  const file = join(dist, PAGE_PATHS[page], "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, out);
}

await writeFile(join(dist, "robots.txt"), robotsTxt(config));
const sitemap = sitemapXml(config);
if (sitemap) await writeFile(join(dist, "sitemap.xml"), sitemap);
await rm(ssr, { recursive: true, force: true });

process.stdout.write(
  `公開のページを作りました(${config.env}・検索に${config.indexable ? "載せる" : "載せない"}): ${PAGES.join(", ")}\n`,
);
