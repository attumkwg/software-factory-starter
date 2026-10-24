// w-ledger: 見直す日(review_by)の過ぎた台帳の項目が無いか・世の中の変化の取り込み(/checkup-refresh)を流す時期でないか。
// ひな形(キットのリポジトリ。ctx.role === "template")では落とさない: キットは定期で回さず、持ち主が呼んだときに
// /checkup-refresh を1回流す。溜まった分は、使う人が作り始めるときに pnpm setup:github が知らせる(ADR 0027)。
import { REFRESH_DAYS, refreshDue, reviewDue } from "../todo.mjs";

export async function check(ctx) {
  const due = reviewDue(ctx.ledger, ctx.today);
  const refresh = refreshDue(ctx.ledger, ctx.today);
  const problems = [];
  if (due.length > 0)
    problems.push(`見直す日が来た項目 ${due.length}件: ${due.map((i) => i.id).join("・")}`);
  if (refresh.due)
    problems.push(
      refresh.days === undefined
        ? "世の中の変化の取り込みを一度も流していない(Claude Code で /checkup-refresh)"
        : `世の中の変化の取り込みから ${refresh.days}日(${REFRESH_DAYS}日を過ぎた。Claude Code で /checkup-refresh)`,
    );
  if (problems.length === 0)
    return {
      result: "pass",
      note: "見直す日の過ぎた項目は無い・世の中の変化の取り込みも済んでいる",
    };
  if (ctx.role === "template")
    return {
      result: "pass",
      note: `ひな形なので定期では回さない(呼んだときに /checkup-refresh): ${problems.join(" / ")}`,
    };
  return { result: "fail", note: problems.join(" / ") };
}
