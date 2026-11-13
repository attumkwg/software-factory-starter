// 🎨 使いやすさを見る人に渡す画面の画像を選ぶ(仕様 0099)。CLI は scripts/ux-screens.mjs。
// VRT の基準の画像(apps/web/e2e/vrt/__screenshots__/<幅>/<画面>.png)のうち、PR で変わった物を
// 変わる前(main)・後(PR の版)の組にする。変わった物が無ければ、PR の版の画像を全部「後」で出す。

export const SHOTS_DIR = "apps/web/e2e/vrt/__screenshots__/";

/** VRT の基準の画像の道か。幅と画面の名前を返す(違えば null) */
export function shotOf(path) {
  if (!path.startsWith(SHOTS_DIR) || !path.endsWith(".png")) return null;
  const rest = path.slice(SHOTS_DIR.length, -".png".length).split("/");
  if (rest.length !== 2 || !rest[0] || !rest[1]) return null;
  return { width: rest[0], screen: rest[1] };
}

/** 画面を変える PR か(🎨 を呼ぶか)。review-viewpoints.md の 🎨 の「呼ぶ PR」と同じ道 */
export function touchesScreens(changed) {
  return changed.some(
    (p) =>
      (p.startsWith("apps/web/src/") ||
        p.startsWith("packages/ui/") ||
        p.startsWith("apps/site/")) &&
      !/\.(test|spec)\.[cm]?[jt]sx?$/.test(p),
  );
}

/**
 * 取り出す画像の一覧。
 * @param {string[]} changed PR で変わったファイルの道
 * @param {string[]} headShots PR の版にある基準の画像の道(全部)
 * @returns {{ changedShots: boolean, files: { side: "before" | "after", path: string, name: string }[] }}
 */
export function planShots(changed, headShots) {
  const nameOf = (side, s) => `${side}-${s.width}-${s.screen}.png`;
  const changedShots = changed.map((p) => ({ p, s: shotOf(p) })).filter((x) => x.s);
  if (changedShots.length === 0) {
    const files = headShots
      .map((p) => ({ p, s: shotOf(p) }))
      .filter((x) => x.s)
      .map(({ p, s }) => ({ side: "after", path: p, name: nameOf("after", s) }));
    return { changedShots: false, files };
  }
  const files = [];
  for (const { p, s } of changedShots) {
    files.push({ side: "before", path: p, name: nameOf("before", s) });
    if (headShots.includes(p)) files.push({ side: "after", path: p, name: nameOf("after", s) });
  }
  return { changedShots: true, files };
}
