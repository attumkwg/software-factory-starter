// gh-protection: main に「PR 必須・CI 必須・最新に追いついてから」が効いているか。
// ルールセット(rules/branches/main。読む権限だけで見られる)を先に見て、足りなければ旧来のブランチ保護も見る。
import { unknownFrom } from "../gh.mjs";

const fromRules = (rules) => {
  const pr = rules.some((r) => r.type === "pull_request");
  const checks = rules.find((r) => r.type === "required_status_checks")?.parameters;
  return {
    pr,
    ci: (checks?.required_status_checks ?? []).length > 0,
    strict: checks?.strict_required_status_checks_policy === true,
  };
};

const fromClassic = (p) => ({
  pr: Boolean(p?.required_pull_request_reviews),
  ci: (p?.required_status_checks?.contexts ?? p?.required_status_checks?.checks ?? []).length > 0,
  strict: p?.required_status_checks?.strict === true,
});

const missing = (s) =>
  [!s.pr && "PR 必須", !s.ci && "CI 必須", !s.strict && "最新に追いついてから"].filter(Boolean);

export async function check(ctx) {
  const rules = ctx.api("rules/branches/main");
  if (!rules.ok) return unknownFrom(rules, "main のルール");
  const viaRules = fromRules(rules.data ?? []);
  if (missing(viaRules).length === 0)
    return { result: "pass", note: "ルールセットで PR 必須・CI 必須・最新に追いついてから" };
  const classic = ctx.api("branches/main/protection");
  if (!classic.ok && classic.status !== 404) {
    if (classic.status === 403 && classic.message.includes("Upgrade"))
      return { result: "fail", note: "プランのせいでブランチ保護が効かない(gh-plan)" };
    return unknownFrom(classic, "ブランチ保護");
  }
  const s = classic.ok ? fromClassic(classic.data) : { pr: false, ci: false, strict: false };
  const merged = {
    pr: viaRules.pr || s.pr,
    ci: viaRules.ci || s.ci,
    strict: viaRules.strict || s.strict,
  };
  const lack = missing(merged);
  return lack.length === 0
    ? { result: "pass", note: "PR 必須・CI 必須・最新に追いついてから" }
    : { result: "fail", note: `main の保護に足りない物: ${lack.join("・")}` };
}
