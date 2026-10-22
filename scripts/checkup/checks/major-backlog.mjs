// major-backlog: 大きい版の更新が溜まっていないか。2か所を見る:
//   - Dependency Dashboard の「承認待ち」(renovate.json で大きい版は承認するまで PR にならない)。半年の点検の時点で残っていれば溜まっている
//   - 更新の PR(Renovate)が30日より長く開いたまま。小さい更新はまとめてマージされるので、長く残るのはたいてい承認した大きい版
import { unknownFrom } from "../gh.mjs";
import { addDays } from "../phase.mjs";
import { pendingApprovals, renovatePrs } from "../queries.mjs";

export const MAX_DAYS = 30;

export async function check(ctx) {
  const all = renovatePrs(ctx, "");
  if (!all.ok) return unknownFrom(all, "Renovate の PR");
  if (!(all.data?.total_count > 0))
    return { result: "unknown", note: "Renovate が動いていない(dep-renovate)" };
  const old = renovatePrs(ctx, `is:open created:<${addDays(ctx.today, -MAX_DAYS)}`);
  if (!old.ok) return unknownFrom(old, "Renovate の PR");
  const pending = pendingApprovals(ctx);
  if (!pending.ok) return unknownFrom(pending, "Dependency Dashboard");
  const n = old.data?.total_count ?? 0;
  const waiting = pending.data;
  const notes = [];
  if (n > 0) notes.push(`${MAX_DAYS}日より長く開いている更新が ${n}件`);
  if (waiting.length > 0)
    notes.push(`承認待ちの大きい版が ${waiting.length}件(${waiting.slice(0, 5).join("・")})`);
  return notes.length === 0
    ? { result: "pass", note: `${MAX_DAYS}日より長く開いている更新も、承認待ちの大きい版も無い` }
    : { result: "fail", note: `${notes.join("/")}。上げるか、上げない理由を台帳に書く` };
}
