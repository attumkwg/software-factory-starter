// setup-drift: .github/setup.yml(正)と GitHub の今の設定がずれていないか(w-protection の3つ目。G-74)。
// 見るのは、ずれると守りが黙って弱くなる物だけ: 必須のチェック・最新に追いついてから・承認の数・prod などの承認する人。
// 読むだけ(rules/branches/main と environments。点検の読む権限のトークンで見られる)。直すのは人の pnpm setup:github --apply。
// 決まり: docs/designs/0014-setup-before-use.md の 8.
import { parse } from "yaml";
import { desiredRules } from "../../setup/areas-ruleset.mjs";
import { SETUP_FILE } from "../../setup/config.mjs";
import { unknownFrom } from "../gh.mjs";

const FIX = "直し方: pnpm setup:github で差分を見て --apply(リポジトリの管理者が手元で)";

/** main にかかる規則(ルールセットが複数でも合わせて見る)から、比べる値を取り出す */
export function liveRules(rules) {
  const pr = rules.filter((r) => r.type === "pull_request").map((r) => r.parameters ?? {});
  const checks = rules
    .filter((r) => r.type === "required_status_checks")
    .map((r) => r.parameters ?? {});
  return {
    approvals:
      pr.length === 0
        ? undefined
        : Math.max(...pr.map((p) => p.required_approving_review_count ?? 0)),
    checks: [
      ...new Set(checks.flatMap((p) => (p.required_status_checks ?? []).map((c) => c.context))),
    ],
    strict: checks.some((p) => p.strict_required_status_checks_policy === true),
  };
}

/** ルールセットのずれ(人が読む1行ずつ)。正の形は pnpm setup:github と同じ desiredRules から作る */
export function rulesetDrift(rs, rules) {
  const want = desiredRules(rs);
  const wantPr = want.find((r) => r.type === "pull_request").parameters;
  const wantChecks = want.find((r) => r.type === "required_status_checks").parameters;
  const now = liveRules(rules);
  const have = new Set(now.checks);
  const need = new Set(wantChecks.required_status_checks.map((c) => c.context));
  const out = [];
  const missing = [...need].filter((c) => !have.has(c));
  const extra = now.checks.filter((c) => !need.has(c));
  if (missing.length > 0) out.push(`必須になっていないチェック: ${missing.join("・")}`);
  if (extra.length > 0) out.push(`setup.yml に無い必須のチェック: ${extra.join("・")}`);
  if (now.strict !== wantChecks.strict_required_status_checks_policy)
    out.push(
      `最新に追いついてから: ${now.strict} → ${wantChecks.strict_required_status_checks_policy}`,
    );
  if (now.approvals === undefined) out.push("PR 必須の規則が無い");
  else if (now.approvals !== wantPr.required_approving_review_count)
    out.push(`承認の数: ${now.approvals} → ${wantPr.required_approving_review_count}`);
  return out;
}

const reviewerRule = (env) =>
  (env?.protection_rules ?? []).find((r) => r.type === "required_reviewers");

/**
 * Environments の承認する人のずれ。@me は「セットアップを打った人」なので名前では比べず、人数だけを数える
 * (点検はトークンの持ち主で動くので、@me が誰かは分からない)
 */
export function environmentDrift(envs, liveEnvs) {
  const byName = new Map((liveEnvs ?? []).map((e) => [e.name, e]));
  const out = [];
  for (const want of envs ?? []) {
    const wantReviewers = want.reviewers ?? [];
    if (wantReviewers.length === 0) continue;
    const now = byName.get(want.name);
    if (!now) continue; // 無いことは gh-envs が見る
    const rule = reviewerRule(now);
    const have = (rule?.reviewers ?? []).map((r) => r.reviewer?.login).filter(Boolean);
    const named = wantReviewers.filter((n) => n !== "@me").map((n) => String(n).replace(/^@/, ""));
    const lacking = named.filter((n) => !have.includes(n));
    if (have.length !== wantReviewers.length)
      out.push(`${want.name} の承認する人: ${have.length}人 → ${wantReviewers.length}人`);
    if (lacking.length > 0) out.push(`${want.name} の承認する人に居ない: ${lacking.join("・")}`);
    if (Boolean(rule?.prevent_self_review) !== Boolean(want.prevent_self_review))
      out.push(
        `${want.name} の自分の承認を止める: ${Boolean(rule?.prevent_self_review)} → ${Boolean(want.prevent_self_review)}`,
      );
  }
  return out;
}

export async function check(ctx) {
  const text = ctx.read(SETUP_FILE);
  if (text === undefined)
    return { result: "unknown", note: `${SETUP_FILE} が無いので、ずれを比べられない` };
  let setup;
  try {
    setup = parse(text);
  } catch {
    return { result: "unknown", note: `${SETUP_FILE} が読めない(pnpm setup:check)` };
  }
  const rules = ctx.api("rules/branches/main");
  if (!rules.ok) return unknownFrom(rules, "main のルール");
  const envs = ctx.api("environments?per_page=100");
  if (!envs.ok && envs.status !== 404) return unknownFrom(envs, "Environments");
  const drift = [
    ...rulesetDrift(setup.ruleset, rules.data ?? []),
    ...environmentDrift(setup.environments, envs.data?.environments),
  ];
  return drift.length === 0
    ? {
        result: "pass",
        note: `${SETUP_FILE} とずれは無い(必須のチェック ${setup.ruleset.required_checks.length}件・承認の数・承認する人)`,
      }
    : { result: "fail", note: `${SETUP_FILE} とずれている: ${drift.join(" / ")}。${FIX}` };
}
