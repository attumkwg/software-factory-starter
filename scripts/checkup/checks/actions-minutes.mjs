// w-minutes: GitHub Actions の分数が、月の枠の8割を超えていないか。公開のリポジトリは枠が無い。
import { unknownFrom } from "../gh.mjs";

export const WARN_RATIO = 0.8;

export async function check(ctx) {
  const repo = ctx.api("");
  if (!repo.ok) return unknownFrom(repo, "リポジトリの情報");
  if (repo.data?.private === false)
    return { result: "pass", note: "公開のリポジトリは分数の枠が無い" };
  const owner = ctx.repo.split("/")[0];
  const kind = repo.data?.owner?.type === "Organization" ? "orgs" : "users";
  const res = ctx.gh(`${kind}/${owner}/settings/billing/actions`);
  if (!res.ok) return unknownFrom(res, "Actions の分数");
  const used = res.data?.total_minutes_used ?? 0;
  const included = res.data?.included_minutes ?? 0;
  if (included <= 0) return { result: "unknown", note: "月の枠が分からなかった" };
  const pct = Math.round((used / included) * 100);
  return used / included >= WARN_RATIO
    ? { result: "fail", note: `今月 ${used}分(枠の ${pct}%)。8割を超えた` }
    : { result: "pass", note: `今月 ${used}分(枠の ${pct}%)` };
}
