import { currentPreRegistrationConsent } from "@app/shared";
import { describe, expect, it } from "vitest";
import { siteConfigFrom } from "./config.ts";
import { render } from "./entry-server.tsx";
import { headFor, robotsTxt, sitemapXml } from "./head.ts";
import { sourceFromSearch, tokenFromHash } from "./source.ts";

// 公開のページ(docs/specs/0025-public-landing-page.md の「キットの中に型を持つ」)。

const prod = siteConfigFrom({
  SITE_ENV: "prod",
  SITE_URL: "https://www.example.test",
  APP_URL: "https://app.example.test",
});
const stg = siteConfigFrom({
  SITE_ENV: "stg",
  SITE_URL: "https://www.stg.example.test",
  APP_URL: "https://app.stg.example.test",
});

describe("設定", () => {
  it("本物の環境(stg・prod)では URL が要り、https・最後に / なし", () => {
    expect(() => siteConfigFrom({ SITE_ENV: "prod" })).toThrow("SITE_URL");
    expect(() =>
      siteConfigFrom({ SITE_ENV: "prod", SITE_URL: "http://x.test", APP_URL: "https://a.test" }),
    ).toThrow("https://");
    expect(() =>
      siteConfigFrom({ SITE_ENV: "stg", SITE_URL: "https://x.test/", APP_URL: "https://a.test" }),
    ).toThrow("/");
    expect(siteConfigFrom({}).env).toBe("local");
    expect(() => siteConfigFrom({ SITE_ENV: "production" })).toThrow("SITE_ENV");
  });

  it("検索に載せるのは prod だけ", () => {
    expect(prod.indexable).toBe(true);
    expect(stg.indexable).toBe(false);
    expect(siteConfigFrom({}).indexable).toBe(false);
  });
});

describe("検索に載せるか", () => {
  it("prod の LP だけ canonical を付け、noindex を付けない", () => {
    expect(headFor("landing", prod)).toContain('rel="canonical" href="https://www.example.test/"');
    expect(headFor("landing", prod)).not.toContain("noindex");
  });

  it("prod 以外の LP・どの環境でも確認と取り消しのページは noindex", () => {
    expect(headFor("landing", stg)).toContain('content="noindex, nofollow"');
    expect(headFor("confirm", prod)).toContain('content="noindex, nofollow"');
    expect(headFor("withdraw", prod)).toContain('content="noindex, nofollow"');
  });

  it("robots.txt: prod は確認と取り消しだけお断りしてサイトマップ・それ以外は全部お断り", () => {
    expect(robotsTxt(prod)).toContain("Disallow: /confirm/");
    expect(robotsTxt(prod)).toContain("Sitemap: https://www.example.test/sitemap.xml");
    expect(robotsTxt(stg)).toBe("User-agent: *\nDisallow: /\n");
  });

  it("サイトマップは prod だけ・LP だけ", () => {
    expect(sitemapXml(prod)).toContain("<loc>https://www.example.test/</loc>");
    expect(sitemapXml(prod)).not.toContain("/confirm/");
    expect(sitemapXml(stg)).toBeNull();
  });
});

describe("LP の中身", () => {
  it("同意の文(いまの版)・同意のチェック・プライバシーポリシーへのリンクが出る", () => {
    const { html } = render("landing", prod);
    const consent = currentPreRegistrationConsent();
    expect(html).toContain(consent.checkbox);
    expect(html).toContain("にだけ使います");
    expect(html).toContain('href="https://app.example.test/legal/privacy"');
  });

  it("集めるのは会社名・メールアドレス・会社の規模だけ(自由記述の欄が無い)", () => {
    const { html } = render("landing", prod);
    expect(html).toContain("会社名");
    expect(html).toContain("メールアドレス");
    expect(html).not.toContain("<textarea");
  });

  it("外のサイトの読み込み(解析・広告のタグ)が無い", () => {
    const { head, html } = render("landing", prod);
    expect(`${head}${html}`).not.toMatch(/<script[^>]+src=/);
    expect(`${head}${html}`).not.toMatch(/<img[^>]+src="https?:/);
  });
});

describe("URL から読む物", () => {
  it("UTM を読む(無ければ undefined)", () => {
    expect(sourceFromSearch("?utm_source=kai&utm_medium=email")).toEqual({
      utmSource: "kai",
      utmMedium: "email",
      utmCampaign: undefined,
    });
  });

  it("リンクの token は # の後ろの t", () => {
    expect(tokenFromHash("#t=abc.def")).toBe("abc.def");
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash(`#t=${"x".repeat(301)}`)).toBeNull();
  });
});
