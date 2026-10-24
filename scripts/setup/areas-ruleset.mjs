// 区分: main のルールセット。設定ファイルが扱う規則(MANAGED)だけを置き換え、ほかの規則と鍵は今の値を残す。
// 決まり: docs/designs/0014-setup-before-use.md の 2.(ルールセットの書き方)・6.
import { ACTIONS_APP_ID } from "./config.mjs";
import { add, change, ok, show, unknown } from "./entries.mjs";

const MANAGED = [
  "deletion",
  "non_fast_forward",
  "required_linear_history",
  "pull_request",
  "required_status_checks",
];
const LABEL = {
  deletion: "消せない",
  non_fast_forward: "強制 push できない",
  required_linear_history: "直線の履歴",
  pull_request: "PR 必須",
  required_status_checks: "必須のチェック",
};
// PR の規則を新しく作るときに API が求める鍵(設定ファイルが扱わない物は、この既定で作る)
const PR_DEFAULTS = { require_last_push_approval: false, required_review_thread_resolution: false };
const CONDITIONS = { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } };

/** 設定ファイルから、扱う規則のあるべき形(false の規則は入れない = 外す) */
export function desiredRules(rs) {
  return [
    rs.block_deletion && { type: "deletion" },
    rs.block_force_push && { type: "non_fast_forward" },
    rs.linear_history && { type: "required_linear_history" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: rs.required_approvals,
        dismiss_stale_reviews_on_push: rs.dismiss_stale_reviews,
        require_code_owner_review: rs.require_code_owner_review,
        allowed_merge_methods: rs.allowed_merge_methods,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: rs.strict,
        required_status_checks: rs.required_checks.map((context) => ({
          context,
          integration_id: ACTIONS_APP_ID,
        })),
      },
    },
  ].filter(Boolean);
}

const sorted = (xs) => [...(xs ?? [])].sort();
const checkKey = (c) => `${c.context}@${c.integration_id ?? "-"}`;

/** 必須のチェックの違い(足す・外す・最新に追いついてから) */
function checksDiffs(now, want) {
  const have = new Set((now.required_status_checks ?? []).map(checkKey));
  const need = new Set(want.required_status_checks.map(checkKey));
  const out = [
    ...want.required_status_checks
      .filter((c) => !have.has(checkKey(c)))
      .map((c) => `必須のチェックに足す: ${c.context}`),
    ...(now.required_status_checks ?? [])
      .filter((c) => !need.has(checkKey(c)))
      .map((c) => `必須のチェックから外す: ${c.context}`),
  ];
  const strict = want.strict_required_status_checks_policy;
  if (now.strict_required_status_checks_policy !== strict)
    out.push(`最新に追いついてから: ${show(now.strict_required_status_checks_policy)} → ${strict}`);
  return out;
}

/** 扱う鍵の違いを、人が読む1行ずつに */
function paramDiffs(type, now = {}, want = {}) {
  if (type === "required_status_checks") return checksDiffs(now, want);
  const same = (k, v) =>
    Array.isArray(v) ? JSON.stringify(sorted(now[k])) === JSON.stringify(sorted(v)) : now[k] === v;
  return Object.entries(want)
    .filter(([k, v]) => !same(k, v))
    .map(([k, v]) => `${LABEL[type]}の ${k}: ${show(now[k])} → ${show(v)}`);
}

/** 今のルールセットとあるべき形の違い(人が読む1行ずつ) */
export function rulesetDiffs(now, desired) {
  const out = [];
  if (now.enforcement !== "active") out.push(`有効にする(今: ${now.enforcement})`);
  if ((now.bypass_actors ?? []).length > 0)
    out.push(`例外(Bypass list)を外す: ${now.bypass_actors.length}件`);
  if (!(now.conditions?.ref_name?.include ?? []).includes("~DEFAULT_BRANCH"))
    out.push("対象に既定のブランチ(main)を入れる");
  const byType = new Map((now.rules ?? []).map((r) => [r.type, r]));
  const wantTypes = new Set(desired.map((r) => r.type));
  for (const want of desired) {
    const have = byType.get(want.type);
    if (!have) out.push(`${LABEL[want.type]}を足す`);
    else if (want.parameters) out.push(...paramDiffs(want.type, have.parameters, want.parameters));
  }
  for (const t of MANAGED) if (byType.has(t) && !wantTypes.has(t)) out.push(`${LABEL[t]}を外す`);
  return out;
}

/** 書く規則: 扱わない規則は今のまま・扱う規則は今の鍵の上にあるべき鍵を重ねる */
export function mergedRules(nowRules, desired) {
  const byType = new Map((nowRules ?? []).map((r) => [r.type, r]));
  const kept = (nowRules ?? []).filter((r) => !MANAGED.includes(r.type));
  const managed = desired.map((want) => {
    if (!want.parameters) return want;
    const base = want.type === "pull_request" ? PR_DEFAULTS : { do_not_enforce_on_create: false };
    return {
      type: want.type,
      parameters: { ...base, ...(byType.get(want.type)?.parameters ?? {}), ...want.parameters },
    };
  });
  return [...kept, ...managed];
}

const body = (name, rules) => ({
  name,
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: CONDITIONS,
  rules,
});

export function planRuleset({ gh, setup }) {
  const rs = setup.ruleset;
  const title = `ルールセット ${rs.name}`;
  const list = gh.get("rulesets?includes_parents=false&per_page=100");
  if (!list.ok) return { title, entries: [unknown("ルールセット", list)] };
  const found = (list.data ?? []).find((r) => r.name === rs.name && r.target === "branch");
  const desired = desiredRules(rs);
  if (!found)
    return {
      title,
      entries: [
        add(
          `作る(${desired.map((r) => LABEL[r.type]).join("・")}・必須のチェック ${rs.required_checks.length}件)`,
          () => gh.write("POST", "rulesets", body(rs.name, mergedRules([], desired))),
        ),
      ],
    };
  const now = gh.get(`rulesets/${found.id}`);
  if (!now.ok) return { title, entries: [unknown(`ルールセット ${rs.name} の中身`, now)] };
  const diffs = rulesetDiffs(now.data, desired);
  if (diffs.length === 0)
    return {
      title,
      entries: [
        ok(
          `${desired.map((r) => LABEL[r.type]).join("・")}(必須のチェック ${rs.required_checks.length}件)`,
        ),
      ],
    };
  return {
    title,
    entries: [
      change(diffs.join(" / "), () =>
        gh.write(
          "PUT",
          `rulesets/${found.id}`,
          body(rs.name, mergedRules(now.data.rules, desired)),
        ),
      ),
    ],
  };
}
