// 区分ごとの差分: ラベル・リポジトリ・守りの機能・Actions・変数・リポジトリの秘密。
// どれも「今を読む → あるべきと比べる → 違う所だけ apply を付ける」。消さない(一覧に無いラベルは表示だけ)。
// 決まり: docs/designs/0014-setup-before-use.md の 2.・6.
import { PUBLIC_ONLY } from "./config.mjs";
import { add, change, describe, differences, extra, ok, skip, todo, unknown } from "./entries.mjs";

/** ラベルを全部読む(100件ずつ) */
function readLabels(gh) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = gh.get(`labels?per_page=100&page=${page}`);
    if (!res.ok) return res;
    all.push(...(res.data ?? []));
    if ((res.data ?? []).length < 100) break;
  }
  return { ok: true, data: all };
}

export function planLabels({ gh, labels }) {
  const res = readLabels(gh);
  if (!res.ok) return { title: "ラベル", entries: [unknown("ラベル", res)] };
  const byName = new Map(res.data.map((l) => [l.name.toLowerCase(), l]));
  const entries = labels.map((want) => {
    const now = byName.get(want.name.toLowerCase());
    const body = {
      name: want.name,
      color: want.color.toLowerCase(),
      description: want.description,
    };
    if (!now) return add(`${want.name} を作る`, () => gh.write("POST", "labels", body));
    const diffs = differences(
      { name: now.name, color: now.color.toLowerCase(), description: now.description ?? "" },
      body,
    );
    if (diffs.length === 0) return ok(want.name);
    return change(`${want.name}(${describe(diffs)})`, () =>
      gh.write("PATCH", `labels/${encodeURIComponent(now.name)}`, {
        new_name: want.name,
        color: body.color,
        description: body.description,
      }),
    );
  });
  const wanted = new Set(labels.map((l) => l.name.toLowerCase()));
  const others = res.data.filter((l) => !wanted.has(l.name.toLowerCase())).map((l) => l.name);
  if (others.length > 0) entries.push(extra(`一覧に無いラベル(消さない): ${others.join("・")}`));
  return { title: "ラベル", entries };
}

export function planRepository({ gh, setup, ctx }) {
  const diffs = differences(ctx.repoData, setup.repository ?? {});
  if (diffs.length === 0)
    return {
      title: "リポジトリの設定",
      entries: [ok("マージの方法・自動マージ・ブランチの自動削除")],
    };
  const body = Object.fromEntries(diffs.map((d) => [d.key, d.want]));
  return {
    title: "リポジトリの設定",
    entries: [change(describe(diffs), () => gh.write("PATCH", "", body))],
  };
}

const status = (on) => (on ? "enabled" : "disabled");
const SA_KEYS = {
  secret_scanning: "secret_scanning",
  push_protection: "secret_scanning_push_protection",
  dependabot_security_updates: "dependabot_security_updates",
};

/** オン・オフを1つ(今の値を読む関数と、変える関数) */
function toggle(name, now, want, apply) {
  if (now === undefined) return skip(`${name}: 今の値が分からない(読む権限が無い?)`);
  return now === want
    ? ok(name)
    : change(`${name}: ${now ? "オン" : "オフ"} → ${want ? "オン" : "オフ"}`, apply);
}

/** secret scanning・push の保護・Dependabot の直す PR(リポジトリの security_and_analysis) */
function analysisEntries(gh, want, ctx) {
  const isPublic = ctx.repoData.visibility === "public";
  const sa = ctx.repoData.security_and_analysis ?? {};
  return Object.entries(SA_KEYS)
    .filter(([key]) => key in want)
    .map(([key, field]) => {
      if (PUBLIC_ONLY.includes(key) && !isPublic)
        return skip(`${key}: 非公開のリポジトリでは有料(CI の gitleaks で代える)`);
      const now = sa[field]?.status === undefined ? undefined : sa[field].status === "enabled";
      return toggle(key, now, want[key], () =>
        gh.write("PATCH", "", {
          security_and_analysis: { [field]: { status: status(want[key]) } },
        }),
      );
    });
}

function alertsEntry(gh, want) {
  const res = gh.get("vulnerability-alerts");
  const now = res.ok ? true : res.status === 404 ? false : undefined;
  return toggle("dependabot_alerts", now, want.dependabot_alerts, () =>
    gh.write(want.dependabot_alerts ? "PUT" : "DELETE", "vulnerability-alerts"),
  );
}

function reportingEntry(gh, want, ctx) {
  const key = "private_vulnerability_reporting";
  if (ctx.repoData.visibility !== "public") return skip(`${key}: 公開のリポジトリだけ`);
  const res = gh.get("private-vulnerability-reporting");
  return toggle(key, res.ok ? res.data?.enabled : undefined, want[key], () =>
    gh.write(want[key] ? "PUT" : "DELETE", "private-vulnerability-reporting"),
  );
}

export function planSecurity({ gh, setup, ctx }) {
  const want = setup.security ?? {};
  const entries = analysisEntries(gh, want, ctx);
  if ("dependabot_alerts" in want) entries.push(alertsEntry(gh, want));
  if ("private_vulnerability_reporting" in want) entries.push(reportingEntry(gh, want, ctx));
  return { title: "守りの機能", entries };
}

/** Actions の設定1つ(読む所・あるべき・書き方) */
function actionsPart(gh, name, sub, want, body = (now) => ({ ...now, ...want })) {
  const res = gh.get(sub);
  if (!res.ok) return unknown(name, res);
  const diffs = differences(res.data, want);
  if (diffs.length === 0) return ok(name);
  return change(`${name}(${describe(diffs)})`, () => gh.write("PUT", sub, body(res.data)));
}

export function planActions({ gh, setup }) {
  const a = setup.actions ?? {};
  const entries = [
    actionsPart(gh, "ワークフローの権限", "actions/permissions/workflow", {
      default_workflow_permissions: a.default_workflow_permissions,
      can_approve_pull_request_reviews: a.can_approve_pull_request_reviews,
    }),
    actionsPart(
      gh,
      "SHA で固定した Action だけ",
      "actions/permissions",
      { sha_pinning_required: a.sha_pinning_required },
      (now) => ({
        enabled: now.enabled,
        allowed_actions: now.allowed_actions,
        sha_pinning_required: a.sha_pinning_required,
      }),
    ),
    actionsPart(
      gh,
      "外の人の PR の承認",
      "actions/permissions/fork-pr-contributor-approval",
      { approval_policy: a.fork_pr_approval },
      () => ({
        approval_policy: a.fork_pr_approval,
      }),
    ),
    actionsPart(
      gh,
      "成果物とログの保存の日数",
      "actions/permissions/artifact-and-log-retention",
      { days: a.retention_days },
      () => ({
        days: a.retention_days,
      }),
    ),
  ];
  return { title: "Actions の設定", entries };
}

export const ROLE_VARIABLE = "KIT_ROLE";

export function planVariable({ gh, ctx }) {
  const res = gh.get(`actions/variables/${ROLE_VARIABLE}`);
  const body = { name: ROLE_VARIABLE, value: ctx.role };
  const title = "変数(ひな形か使う側か)";
  if (!res.ok && res.status !== 404)
    return { title, entries: [unknown(`変数 ${ROLE_VARIABLE} `, res)] };
  if (!res.ok)
    return {
      title,
      entries: [
        add(`${ROLE_VARIABLE}=${ctx.role} を作る`, () =>
          gh.write("POST", "actions/variables", body),
        ),
      ],
    };
  if (res.data?.value === ctx.role) return { title, entries: [ok(`${ROLE_VARIABLE}=${ctx.role}`)] };
  return {
    title,
    entries: [
      change(`${ROLE_VARIABLE}: ${res.data?.value} → ${ctx.role}`, () =>
        gh.write("PATCH", `actions/variables/${ROLE_VARIABLE}`, body),
      ),
    ],
  };
}

/** リポジトリの秘密(名前だけ。値は人が入れる)。使う側でだけ聞く */
export function planSecrets({ gh, setup, ctx }) {
  const title = "リポジトリの秘密(名前だけ)";
  if (ctx.role !== "product") return { title, entries: [skip("ひな形では聞かない")] };
  const res = gh.get("actions/secrets");
  if (!res.ok) return { title, entries: [unknown("リポジトリの秘密の名前", res)] };
  const have = new Set((res.data?.secrets ?? []).map((s) => s.name));
  return {
    title,
    entries: (setup.secrets ?? []).map((s) =>
      have.has(s.name)
        ? ok(s.name)
        : todo(`使うなら、リポジトリの秘密 ${s.name} を入れる(${s.why})`),
    ),
  };
}
