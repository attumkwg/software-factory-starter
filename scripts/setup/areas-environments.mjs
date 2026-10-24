// 区分: Environments。main からだけ使える・prod の承認する人・秘密の名前(値は人が入れる)。
// 作る・直す(PUT)を先に、配備の決まり(どのブランチから使えるか)を後に並べる(--apply は並びの順に流す)。
// 決まり: docs/designs/0014-setup-before-use.md の 2.・6.
import { add, change, ok, remove, todo, unknown } from "./entries.mjs";

/** 承認する人の名前(@me は打った人)を { login, id } に。引けなければ { error } */
export function resolveReviewers(gh, names, me) {
  const out = [];
  for (const name of names ?? []) {
    if (name === "@me") {
      if (!me) return { error: "打った人(gh api user)が分からない" };
      out.push(me);
      continue;
    }
    const login = String(name).replace(/^@/, "");
    const res = gh.getPath(`users/${login}`);
    if (!res.ok) return { error: `${login} を引けない` };
    out.push({ login: res.data.login, id: res.data.id });
  }
  return { reviewers: out };
}

const reviewersOf = (env) =>
  (env?.protection_rules ?? []).find((r) => r.type === "required_reviewers");

/** Environment そのもの(main だけ・承認する人)の違い */
function envDiffs(now, want, reviewers) {
  if (!now) return ["作る"];
  const out = [];
  const policy = now.deployment_branch_policy;
  if (policy?.custom_branch_policies !== true || policy?.protected_branches !== false)
    out.push("使えるブランチを「選んだ物だけ」にする");
  const rule = reviewersOf(now);
  const have = (rule?.reviewers ?? []).map((r) => r.reviewer?.login).sort();
  const need = reviewers.map((r) => r.login).sort();
  if (JSON.stringify(have) !== JSON.stringify(need))
    out.push(`承認する人: ${have.join("・") || "(無し)"} → ${need.join("・") || "(無し)"}`);
  if (need.length > 0 && Boolean(rule?.prevent_self_review) !== Boolean(want.prevent_self_review))
    out.push(
      `自分の承認を止める: ${Boolean(rule?.prevent_self_review)} → ${Boolean(want.prevent_self_review)}`,
    );
  return out;
}

/** 配備の決まり(どのブランチから使えるか)の差分 */
function branchEntries(gh, name, want, exists) {
  if (!exists)
    return want.branches.map((b) =>
      add(`${name}: ${b} から使えるようにする`, () =>
        gh.write("POST", `environments/${name}/deployment-branch-policies`, {
          name: b,
          type: "branch",
        }),
      ),
    );
  const res = gh.get(`environments/${name}/deployment-branch-policies?per_page=100`);
  if (!res.ok) return [unknown(`${name} の配備の決まり`, res)];
  const now = res.data?.branch_policies ?? [];
  const entries = [];
  for (const b of want.branches)
    if (!now.some((p) => p.name === b && (p.type ?? "branch") === "branch"))
      entries.push(
        add(`${name}: ${b} から使えるようにする`, () =>
          gh.write("POST", `environments/${name}/deployment-branch-policies`, {
            name: b,
            type: "branch",
          }),
        ),
      );
  for (const p of now)
    if (!want.branches.includes(p.name) || (p.type ?? "branch") !== "branch")
      entries.push(
        remove(`${name}: ${p.name}(${p.type ?? "branch"})から使えないようにする`, () =>
          gh.write("DELETE", `environments/${name}/deployment-branch-policies/${p.id}`),
        ),
      );
  return entries.length > 0 ? entries : [ok(`${name}: ${want.branches.join("・")} からだけ`)];
}

/** 秘密の名前が Environment にあるか(無ければ人がやること) */
function secretEntries(gh, name, want, exists) {
  if (!(want.secrets ?? []).length) return [];
  const res = exists ? gh.get(`environments/${name}/secrets`) : { ok: true, data: { secrets: [] } };
  if (!res.ok) return [unknown(`${name} の秘密の名前`, res)];
  const have = new Set((res.data?.secrets ?? []).map((s) => s.name));
  const missing = want.secrets.filter((s) => !have.has(s));
  return missing.length === 0
    ? [ok(`${name}: 秘密 ${want.secrets.join("・")}`)]
    : [todo(`使うなら、Environment ${name} に秘密 ${missing.join("・")} を入れる(値は人が画面で)`)];
}

function planOne(gh, want, now, me) {
  const r = resolveReviewers(gh, want.reviewers, me);
  if (r.error) return [{ state: "unknown", text: `${want.name}: ${r.error}` }];
  const diffs = envDiffs(now, want, r.reviewers);
  const put = () =>
    gh.write("PUT", `environments/${want.name}`, {
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      reviewers: r.reviewers.map((x) => ({ type: "User", id: x.id })),
      ...(r.reviewers.length > 0 ? { prevent_self_review: Boolean(want.prevent_self_review) } : {}),
    });
  const head =
    diffs.length === 0
      ? ok(
          `${want.name}${r.reviewers.length ? `(承認: ${r.reviewers.map((x) => x.login).join("・")})` : ""}`,
        )
      : now
        ? change(`${want.name}: ${diffs.join("、")}`, put)
        : add(`${want.name} を作る`, put);
  const usable = Boolean(now) && now.deployment_branch_policy?.custom_branch_policies === true;
  return [
    head,
    ...branchEntries(gh, want.name, want, usable),
    ...secretEntries(gh, want.name, want, Boolean(now)),
  ];
}

export function planEnvironments({ gh, setup, ctx }) {
  const title = "Environments";
  const res = gh.get("environments?per_page=100");
  if (!res.ok && res.status !== 404) return { title, entries: [unknown("Environments", res)] };
  const byName = new Map((res.data?.environments ?? []).map((e) => [e.name, e]));
  return {
    title,
    entries: (setup.environments ?? []).flatMap((want) =>
      planOne(gh, want, byName.get(want.name), ctx.me),
    ),
  };
}
