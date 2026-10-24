// w-ledger: 見直す日(review_by)の過ぎた台帳の項目が無いか・世の中の変化の取り込み(/checkup-refresh)を流す時期でないか。
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
  return problems.length === 0
    ? { result: "pass", note: "見直す日の過ぎた項目は無い・世の中の変化の取り込みも済んでいる" }
    : { result: "fail", note: problems.join(" / ") };
}
