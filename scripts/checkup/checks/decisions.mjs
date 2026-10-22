// w-decisions: 期限の過ぎた「保留」・残った「仮決め」が無いか(pnpm decisions --strict が通るか)。
export async function check(ctx) {
  const r = ctx.run("node", ["scripts/decisions.mjs", "--strict"]);
  if (r.error) return { result: "unknown", note: `pnpm decisions を流せなかった(${r.error})` };
  return r.code === 0
    ? { result: "pass", note: "仮決め・期限の過ぎた保留は無い" }
    : { result: "fail", note: "仮決めか期限の過ぎた保留がある(pnpm decisions で一覧を見る)" };
}
