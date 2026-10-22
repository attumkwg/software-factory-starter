// w-guards: 危険度「高」の守りが一覧とそろっているか(pnpm guards が通るか)。
export async function check(ctx) {
  const r = ctx.run("node", ["scripts/check-guards.mjs"]);
  if (r.error) return { result: "unknown", note: `pnpm guards を流せなかった(${r.error})` };
  return r.code === 0
    ? { result: "pass", note: "pnpm guards が通った" }
    : { result: "fail", note: "pnpm guards が落ちた(手元で pnpm guards を流して見る)" };
}
