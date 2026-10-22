// major-backlog: 更新の PR(Renovate)が30日より長く開いたまま溜まっていないか。
// 小さい更新はまとめてマージされるので、長く残るのはたいてい大きい版(Node・React・TanStack・PostgreSQL)。
import { unknownFrom } from "../gh.mjs";
import { addDays } from "../phase.mjs";
import { renovatePrs } from "../queries.mjs";

export const MAX_DAYS = 30;

export async function check(ctx) {
  const all = renovatePrs(ctx, "");
  if (!all.ok) return unknownFrom(all, "Renovate の PR");
  if (!(all.data?.total_count > 0))
    return { result: "unknown", note: "Renovate が動いていない(dep-renovate)" };
  const old = renovatePrs(ctx, `is:open created:<${addDays(ctx.today, -MAX_DAYS)}`);
  if (!old.ok) return unknownFrom(old, "Renovate の PR");
  const n = old.data?.total_count ?? 0;
  return n === 0
    ? { result: "pass", note: `${MAX_DAYS}日より長く開いている更新は無い` }
    : {
        result: "fail",
        note: `${MAX_DAYS}日より長く開いている更新が ${n}件(大きい版が溜まっている)`,
      };
}
