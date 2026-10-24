import { createIsomorphicFn } from "@tanstack/react-start";

// 画面ごとの <title>・説明(meta description)・OGP(チャットにリンクを貼ったときのカード)。route の head で使う。
//
// - 検索に載せるかどうかは、ここでは決めない。画面のサーバーが全部の応答に `X-Robots-Tag: noindex` を付ける
//   (server/app.ts の INDEXABLE_PATHS。docs/designs/0015-web-noindex-mobile.md)。
//   `<meta name="robots">` を出さないのはそのため(2か所で決めると食い違う)
// - og:url と og:image は絶対 URL が要る。画面の URL は環境変数 APP_URL から(API と同じ名前)。
//   無ければ og:url と og:image は出さない(他は出す)
// - 同じ name・property の meta は、深い route の物が勝つ(TanStack Router の HeadContent)。
//   root が既定を出し、画面ごとに上書きする

/** プロダクトの名前(タブ・og:site_name)。キットを使い始めたら自分の名前に */
export const SITE_NAME = "Tasks";
/** 説明を書かない画面の説明。キットを使い始めたら自分の言葉に */
export const SITE_DESCRIPTION = "組織のプロジェクトとタスクを、チームで管理する業務アプリです。";

export type PageHeadInput = {
  /** 画面の名前。タブには「<名前> | Tasks」と出る。無ければプロダクトの名前だけ */
  title?: string;
  /** 1〜2文。検索の結果やリンクのカードに出る。無ければ SITE_DESCRIPTION */
  description?: string;
  /** og:url にするパス("/login")。? 以降は付けない(個人の情報や戻り先を載せない)。ログインの後ろの画面には付けない */
  path?: string;
  /** og:type。ふつうは website。規約の本文のような文書は article */
  type?: "website" | "article";
  /** og:image にする public/ の画像のパス("/og.png")。SVG はカードに出ないことが多いので PNG か JPEG */
  image?: string;
};

type Meta =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

/** 画面の URL の元(https://app.example.com)。サーバーでは環境変数から、ブラウザでは <html data-app-url> から読む */
export const siteOrigin = createIsomorphicFn()
  .server((): string | undefined => originOf(process.env.APP_URL))
  .client((): string | undefined => document.documentElement.dataset.appUrl);

/** 正しい URL なら、その origin(パスや末尾の / を落とす)。違えば undefined(壊れた og:url を出さない) */
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol, origin } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? origin : undefined;
  } catch {
    return undefined;
  }
}

/** route の head に返す形。`head: () => pageHead({ title: "ログイン", description: "…", path: "/login" })` */
export function pageHead(
  page: PageHeadInput = {},
  origin: string | undefined = siteOrigin(),
): { meta: Meta[] } {
  const title = page.title ? `${page.title} | ${SITE_NAME}` : SITE_NAME;
  const description = page.description ?? SITE_DESCRIPTION;
  const meta: Meta[] = [
    { title },
    { name: "description", content: description },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: page.title ?? SITE_NAME },
    { property: "og:description", content: description },
    { property: "og:type", content: page.type ?? "website" },
    { property: "og:locale", content: "ja_JP" },
  ];
  if (origin && page.path?.startsWith("/")) {
    meta.push({ property: "og:url", content: `${origin}${page.path.split(/[?#]/)[0]}` });
  }
  if (origin && page.image?.startsWith("/")) {
    meta.push({ property: "og:image", content: `${origin}${page.image}` });
  }
  return { meta };
}
