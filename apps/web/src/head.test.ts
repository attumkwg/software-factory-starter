import { describe, expect, it } from "vitest";
import { originOf, pageHead, SITE_DESCRIPTION, SITE_NAME } from "./head.ts";
import { legalDocumentHead } from "./legal/view.ts";

const ORIGIN = "https://app.example.com";

/** meta の配列を「名前 → 値」に(title は "title") */
function tags(head: { meta: object[] }): Record<string, string> {
  return Object.fromEntries(
    head.meta.map((m) =>
      "title" in m
        ? ["title", String(m.title)]
        : [
            String("name" in m ? m.name : (m as { property: string }).property),
            String((m as { content: string }).content),
          ],
    ),
  );
}

describe("pageHead", () => {
  it("公開の画面: title・説明・OGP(og:url は APP_URL の origin+パス)を出す", () => {
    const t = tags(
      pageHead({ title: "ログイン", description: "ログインします。", path: "/login" }, ORIGIN),
    );
    expect(t).toEqual({
      title: `ログイン | ${SITE_NAME}`,
      description: "ログインします。",
      "og:site_name": SITE_NAME,
      "og:title": "ログイン",
      "og:description": "ログインします。",
      "og:type": "website",
      "og:locale": "ja_JP",
      "og:url": `${ORIGIN}/login`,
    });
  });

  it("引数なし(root の既定): プロダクトの名前と既定の説明。og:url は出さない", () => {
    const t = tags(pageHead({}, ORIGIN));
    expect(t.title).toBe(SITE_NAME);
    expect(t.description).toBe(SITE_DESCRIPTION);
    expect(t["og:title"]).toBe(SITE_NAME);
    expect(t["og:url"]).toBeUndefined();
  });

  it("検索に載せるかは決めない(robots の meta を出さない。noindex は server/app.ts が全部の応答に付ける)", () => {
    const head = pageHead({ title: "x", description: "y", path: "/x", image: "/og.png" }, ORIGIN);
    expect(JSON.stringify(head)).not.toMatch(/robots|noindex|googlebot/i);
  });

  it("APP_URL が無いときは og:url と og:image を出さない(壊れた相対 URL を出さない)", () => {
    const t = tags(pageHead({ title: "x", path: "/x", image: "/og.png" }, undefined));
    expect(t["og:url"]).toBeUndefined();
    expect(t["og:image"]).toBeUndefined();
    expect(t["og:title"]).toBe("x");
  });

  it("og:url に ? 以降を載せない(戻り先などを外に出さない)・og:image は絶対 URL", () => {
    const t = tags(
      pageHead({ title: "x", path: "/login?returnTo=%2Fsettings#a", image: "/og.png" }, ORIGIN),
    );
    expect(t["og:url"]).toBe(`${ORIGIN}/login`);
    expect(t["og:image"]).toBe(`${ORIGIN}/og.png`);
  });

  it("パスが / で始まらなければ og:url を出さない(よその URL を指させない)", () => {
    expect(tags(pageHead({ path: "https://evil.example" }, ORIGIN))["og:url"]).toBeUndefined();
  });
});

describe("originOf(APP_URL の読み方)", () => {
  it.each([
    ["https://app.example.com", "https://app.example.com"],
    ["https://app.example.com/", "https://app.example.com"],
    ["https://app.example.com/base/path?q=1", "https://app.example.com"],
    ["http://localhost:8080", "http://localhost:8080"],
  ])("%s → %s", (input, expected) => {
    expect(originOf(input)).toBe(expected);
  });

  it.each([undefined, "", "not a url", "javascript:alert(1)", "ftp://example.com"])(
    "%s は使わない",
    (input) => {
      expect(originOf(input)).toBeUndefined();
    },
  );
});

describe("legalDocumentHead(規約の本文の画面)", () => {
  it("いま効いている版: 文書の名前・説明・article・その文書の URL", () => {
    const t = tags(legalDocumentHead("terms"));
    expect(t.title).toBe(`利用規約 | ${SITE_NAME}`);
    expect(t["og:type"]).toBe("article");
    expect(t.description).toContain("利用規約");
  });

  it("版を選んだ本文は、版の番号が title に入る", () => {
    expect(tags(legalDocumentHead("privacy", "1")).title).toBe(
      `プライバシーポリシー(版 1) | ${SITE_NAME}`,
    );
  });

  it("無い文書は「見つかりません」(説明も既定のまま)", () => {
    const t = tags(legalDocumentHead("cookies"));
    expect(t.title).toBe(`見つかりません | ${SITE_NAME}`);
    expect(t.description).toBe(SITE_DESCRIPTION);
  });
});
