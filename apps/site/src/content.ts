import { PRODUCT_NAME } from "@app/shared";

// LP の言葉(docs/guides/landing-page.md の「LP に要る物」)。**ここは架空の見本**。
// 約束・売り文句・言わないことは docs/product/positioning.md(/positioning)から、名前・トーンは docs/product/brand.md(/brand)から写す。
// 色は packages/ui/src/tokens.css(デザインシステム)のまま使う。ここに色を書かない。
// 変えたら、賭けの小石か docs/product/plan.md の「これまでの判断」に「どの文を・いつ出したか」を1行残す。

export const CONTENT = {
  productName: PRODUCT_NAME,
  /** 運営者の表示(会社の名前・問い合わせ先) */
  operator: { name: "サンプル株式会社(架空)", contact: "info@example.test" },
  /** 検索の結果・共有のときの説明(120文字くらいまで) */
  description: "チームのやることを1か所にまとめ、誰が何をしているかが分かる(架空の見本の説明)。",
  hero: {
    /** 約束の1行(相手の言葉で) */
    title: "やることの抜け漏れを、朝のうちに見つける",
    lead: "チームのやることを1か所にまとめ、誰が・いつまでに・何をするかが一目で分かります(架空の見本)。",
  },
  /** 困りごと(話を聞いた相手の言葉から。作らない) */
  problems: [
    "やることが、チャット・メール・紙に散らばっている",
    "誰が何を持っているかを、毎朝聞いて回っている",
    "終わったかどうかが、締め切りの日まで分からない",
  ],
  /** 解決(何がどう変わるか) */
  solutions: [
    "やることをプロジェクトごとに1か所へ",
    "担当と期限が決まっていない物が、すぐ分かる",
    "終わったら、関わる人にだけ知らせる",
  ],
  /** 値段(決まっていなければ null。「提供開始の前にお知らせします」と出す) */
  price: null as string | null,
} as const;
