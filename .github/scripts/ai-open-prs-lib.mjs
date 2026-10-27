// 背景の AI(claude.yml)が開いた PR が多すぎるときは、新しく動かない(G-62・仕様 0063)。
// AI は PR を出し続けられるが、人のレビューは増えない。開いた PR が上限に達したら、レビューして閉じてから頼む。
// 上限の数は claude.yml の AI_OPEN_PR_LIMIT(設計書 0063 の U-1)。

/** 背景の AI が開いた PR か(作った人が Claude のアプリ)。手元の AI の PR は人が作って見ているので数えない */
export const isBackgroundAiPr = (pr) =>
  pr?.user?.type === "Bot" && String(pr.user.login ?? "").startsWith("claude");

/** 上限の数。数でなければ既定の 5 */
export const limitOf = (text) => {
  const n = Number(String(text ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : 5;
};

/** 動かすか。理由の行つき。prs: 開いている PR(GitHub の pulls の形)・limit: 上限 */
export function judgeOpenPrs({ prs, limit }) {
  const open = prs.filter(isBackgroundAiPr);
  const list = open.map((pr) => `#${pr.number}`).join("・");
  if (open.length < limit)
    return {
      ok: true,
      line: `背景の AI が開いた PR は ${open.length} / ${limit} 本${list ? `(${list})` : ""}`,
    };
  return {
    ok: false,
    line: `背景の AI が開いた PR が ${open.length} 本あり、上限(${limit} 本)に達しているので動かない(${list})。レビューして閉じるかマージしてから頼む(docs/guides/unattended-ai.md)`,
  };
}
