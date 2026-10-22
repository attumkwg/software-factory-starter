// w-ledger: 見直す日(review_by)の過ぎた台帳の項目が無いか。
import { reviewDue } from "../todo.mjs";

export async function check(ctx) {
  const due = reviewDue(ctx.ledger, ctx.today);
  return due.length === 0
    ? { result: "pass", note: "見直す日の過ぎた項目は無い" }
    : {
        result: "fail",
        note: `見直す日が来た項目 ${due.length}件: ${due.map((i) => i.id).join("・")}`,
      };
}
