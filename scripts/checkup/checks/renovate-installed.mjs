// dep-renovate: Renovate(GitHub App)が入っているか。Renovate の PR が一度でもあれば合格。
import { unknownFrom } from "../gh.mjs";
import { renovatePrs } from "../queries.mjs";

export async function check(ctx) {
  const res = renovatePrs(ctx, "");
  if (!res.ok) return unknownFrom(res, "Renovate の PR");
  return res.data?.total_count > 0
    ? { result: "pass", note: `Renovate の PR が ${res.data.total_count}件ある` }
    : { result: "fail", note: "Renovate の PR が一度も無い(GitHub App が入っていない)" };
}
