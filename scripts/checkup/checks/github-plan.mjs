// gh-plan: 非公開で無料のプランだと、ブランチ保護の API が 403(Upgrade to GitHub Pro …)を返し、守りが効かない。
// 公開のリポジトリか、保護の API が 403 でなければ合格。
import { unknownFrom } from "../gh.mjs";

export async function check(ctx) {
  const repo = ctx.api("");
  if (!repo.ok) return unknownFrom(repo, "リポジトリの情報");
  if (repo.data?.visibility === "public" || repo.data?.private === false)
    return { result: "pass", note: "公開のリポジトリ(無料でも守りが効く)" };
  const protection = ctx.api("branches/main/protection");
  if (protection.ok || protection.status === 404)
    return { result: "pass", note: "非公開で、守りが効くプラン" };
  if (protection.status === 403 && protection.message.includes("Upgrade"))
    return {
      result: "fail",
      note: "非公開で無料のプラン。ブランチ保護が効かない(公開にするか Pro / Team に)",
    };
  return unknownFrom(protection, "ブランチ保護");
}
