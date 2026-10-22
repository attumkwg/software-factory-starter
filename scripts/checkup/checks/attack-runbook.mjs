// runbook-attack: 攻撃の手順書(docs/runbooks/attack.md)と、WAF が止めた数のアラーム(Terraform の BlockedRequests)があるか。
export const RUNBOOK = "docs/runbooks/attack.md";
export const ALARM_METRIC = "BlockedRequests";

export async function check(ctx) {
  const lack = [];
  if (!ctx.exists(RUNBOOK)) lack.push(`手順書 ${RUNBOOK}`);
  const tf = ctx.files("infra/terraform").filter((f) => f.endsWith(".tf"));
  if (!tf.some((f) => (ctx.read(f) ?? "").includes(ALARM_METRIC)))
    lack.push(`WAF が止めた数(${ALARM_METRIC})のアラーム`);
  return lack.length === 0
    ? { result: "pass", note: "攻撃の手順書と WAF のアラームがある" }
    : { result: "fail", note: `無い物: ${lack.join("・")}` };
}
