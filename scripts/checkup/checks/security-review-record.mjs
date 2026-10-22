// security-review-all: /security-review を全体にかけた記録が、半年以内にあるか。
// 記録の置き場は docs/security/reviews/YYYY-MM-DD.md(1回1ファイル。中身は直した後に書いてよい物だけ)。
import { daysBetween, isDate } from "../phase.mjs";

export const DIR = "docs/security/reviews";
export const MAX_DAYS = 182;

export async function check(ctx) {
  const dates = ctx
    .files(DIR)
    .map((f) => f.slice(DIR.length + 1, DIR.length + 11))
    .filter(isDate)
    .sort();
  const last = dates.at(-1);
  if (!last) return { result: "fail", note: `全体にかけた記録が無い(${DIR}/)` };
  return daysBetween(last, ctx.today) <= MAX_DAYS
    ? { result: "pass", note: `最後に全体にかけた日: ${last}` }
    : { result: "fail", note: `最後に全体にかけたのが ${last}(半年より前)` };
}
