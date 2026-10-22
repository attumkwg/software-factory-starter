// gh-envs: Environments(stg・prod・claude)が main からだけ使えるか。
import { unknownFrom } from "../gh.mjs";

export const ENVIRONMENTS = ["stg", "prod", "claude"];

const onlyMain = (ctx, name) => {
  const policies = ctx.api(`environments/${name}/deployment-branch-policies`);
  if (!policies.ok) return { error: policies };
  const list = policies.data?.branch_policies ?? [];
  return {
    ok: list.length === 1 && list[0].name === "main" && (list[0].type ?? "branch") === "branch",
  };
};

export async function check(ctx) {
  const envs = ctx.api("environments");
  if (!envs.ok) return unknownFrom(envs, "Environments");
  const byName = new Map((envs.data?.environments ?? []).map((e) => [e.name, e]));
  const bad = [];
  for (const name of ENVIRONMENTS) {
    const env = byName.get(name);
    if (!env) {
      bad.push(`${name} が無い`);
      continue;
    }
    if (env.deployment_branch_policy?.custom_branch_policies !== true) {
      bad.push(`${name} がどのブランチからでも使える`);
      continue;
    }
    const r = onlyMain(ctx, name);
    if (r.error) return unknownFrom(r.error, `${name} の配備の決まり`);
    if (!r.ok) bad.push(`${name} が main 以外からも使える`);
  }
  return bad.length === 0
    ? { result: "pass", note: `${ENVIRONMENTS.join("・")} とも main だけ` }
    : { result: "fail", note: bad.join("・") };
}
