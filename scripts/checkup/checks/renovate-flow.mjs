// w-renovate: Renovate の PR が7日より長く止まっていないか・14日 PR が来ていなければ動いていない。
import { unknownFrom } from "../gh.mjs";
import { daysBetween } from "../phase.mjs";
import { renovatePrs } from "../queries.mjs";

export const STUCK_DAYS = 7;
export const SILENT_DAYS = 14;

export async function check(ctx) {
  const res = renovatePrs(ctx, "");
  if (!res.ok) return unknownFrom(res, "Renovate の PR");
  const prs = res.data?.items ?? [];
  const age = (pr) => daysBetween(String(pr.created_at).slice(0, 10), ctx.today);
  const bad = [];
  if (prs.length === 0) bad.push("Renovate の PR が一度も無い(dep-renovate)");
  else if (Math.min(...prs.map(age)) > SILENT_DAYS)
    bad.push(`${SILENT_DAYS}日より長く新しい PR が来ていない(動いていない)`);
  const stuck = prs.filter((pr) => pr.state === "open" && age(pr) > STUCK_DAYS);
  if (stuck.length > 0) bad.push(`${STUCK_DAYS}日より長く開いている PR が ${stuck.length}件`);
  return bad.length === 0
    ? { result: "pass", note: "Renovate の PR が流れている" }
    : { result: "fail", note: bad.join("・") };
}
