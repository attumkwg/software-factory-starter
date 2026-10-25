// 証跡の集め先(GitHub)。どれも読むだけ(ctx.api = gh api repos/<owner>/<name>/…)。秘密の値は API でも読めない。
// 戻り値は { ok: true, data } か { ok: false, message }(ctx.api の失敗をそのまま)。
const fail = (res, what) => ({
  ok: false,
  message: `${what}を読めなかった(${res.status ? `HTTP ${res.status}` : res.message})`,
});

/** 証跡に「訓練・点検の結果」として残すワークフロー(最後の実行の結果と日時) */
export const DRILL_WORKFLOWS = [
  "restore-drill.yml",
  "security-fuzz.yml",
  "zap-api-scan.yml",
  "cognito-contract.yml",
  "checkup.yml",
  "vuln-scan.yml",
  "evidence.yml",
];

async function ruleset(ctx) {
  const list = ctx.api("rulesets?includes_parents=true&per_page=100");
  if (!list.ok) return fail(list, "ルールセットの一覧");
  const rulesets = [];
  for (const r of list.data ?? []) {
    const one = ctx.api(`rulesets/${r.id}`);
    if (!one.ok) return fail(one, `ルールセット ${r.name}`);
    const { name, target, enforcement, conditions, rules, bypass_actors, updated_at } = one.data;
    rulesets.push({ name, target, enforcement, conditions, rules, bypass_actors, updated_at });
  }
  const main = ctx.api("rules/branches/main");
  return { ok: true, data: { rulesets, effective_on_main: main.ok ? main.data : null } };
}

const reviewerName = (r) => r?.reviewer?.login ?? r?.reviewer?.slug ?? r?.reviewer?.name;

async function environments(ctx) {
  const res = ctx.api("environments?per_page=100");
  if (!res.ok) return fail(res, "Environments");
  const data = [];
  for (const env of res.data?.environments ?? []) {
    const branches = env.deployment_branch_policy?.custom_branch_policies
      ? ctx.api(`environments/${encodeURIComponent(env.name)}/deployment-branch-policies`)
      : undefined;
    data.push({
      name: env.name,
      deployment_branch_policy: env.deployment_branch_policy,
      allowed_branches: branches?.ok ? branches.data?.branch_policies?.map((b) => b.name) : null,
      protection_rules: (env.protection_rules ?? []).map((p) => ({
        type: p.type,
        wait_timer: p.wait_timer,
        prevent_self_review: p.prevent_self_review,
        reviewers: (p.reviewers ?? []).map((r) => ({ type: r.type, name: reviewerName(r) })),
      })),
      updated_at: env.updated_at,
    });
  }
  return { ok: true, data };
}

async function collaborators(ctx) {
  const res = ctx.api("collaborators?affiliation=all&per_page=100");
  if (!res.ok) return fail(res, "共同作業者");
  const invites = ctx.api("invitations?per_page=100");
  return {
    ok: true,
    data: {
      collaborators: (res.data ?? []).map((c) => ({
        login: c.login,
        type: c.type,
        role: c.role_name,
      })),
      pending_invitations: invites.ok
        ? (invites.data ?? []).map((i) => ({
            login: i.invitee?.login,
            permissions: i.permissions,
            created_at: i.created_at,
          }))
        : null,
    },
  };
}

async function actionsSettings(ctx) {
  const perms = ctx.api("actions/permissions");
  if (!perms.ok) return fail(perms, "Actions の設定");
  const workflow = ctx.api("actions/permissions/workflow");
  const retention = ctx.api("actions/permissions/artifact-and-log-retention");
  return {
    ok: true,
    data: {
      permissions: perms.data,
      workflow: workflow.ok ? workflow.data : null,
      retention: retention.ok ? retention.data : null,
    },
  };
}

/** 開いている通知は件数だけ(中身は書かない。docs/guides/vulnerabilities.md) */
function countOpen(ctx, path) {
  const res = ctx.api(`${path}?state=open&per_page=100`);
  if (!res.ok) return null;
  const bySeverity = {};
  for (const a of res.data ?? []) {
    const sev = a.security_advisory?.severity ?? a.rule?.security_severity_level ?? "unknown";
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }
  return { open: (res.data ?? []).length, by_severity: bySeverity };
}

async function security(ctx) {
  const repo = ctx.api("");
  if (!repo.ok) return fail(repo, "リポジトリの情報");
  return {
    ok: true,
    data: {
      visibility: repo.data?.visibility,
      security_and_analysis: repo.data?.security_and_analysis ?? null,
      dependabot_alerts: countOpen(ctx, "dependabot/alerts"),
      secret_scanning_alerts: countOpen(ctx, "secret-scanning/alerts"),
      code_scanning_alerts: countOpen(ctx, "code-scanning/alerts"),
    },
  };
}

/** 訓練・点検のワークフローの、前の月の初めから後の実行(結果と日時とリンク)。無いワークフローは null */
async function drills(ctx) {
  const since = `${ctx.since}`;
  const data = {};
  for (const file of DRILL_WORKFLOWS) {
    const res = ctx.api(
      `actions/workflows/${file}/runs?per_page=20&created=${encodeURIComponent(`>=${since}`)}`,
    );
    data[file] = res.ok
      ? (res.data?.workflow_runs ?? []).map((r) => ({
          event: r.event,
          status: r.status,
          conclusion: r.conclusion,
          created_at: r.created_at,
          head_sha: r.head_sha,
          url: r.html_url,
        }))
      : null;
  }
  return { ok: true, data };
}

export const GITHUB_SOURCES = [
  {
    name: "github-ruleset",
    about: "main のルールセット(PR 必須・必須のチェック・強制 push の禁止・例外)",
    collect: ruleset,
  },
  {
    name: "github-environments",
    about: "Environments(使えるブランチ・承認する人)",
    collect: environments,
  },
  {
    name: "github-collaborators",
    about: "リポジトリの共同作業者と権限・招待中の人",
    collect: collaborators,
  },
  {
    name: "github-actions",
    about: "Actions の設定(既定の権限・承認できるか・SHA の固定・保存の日数)",
    collect: actionsSettings,
  },
  {
    name: "github-security",
    about: "守りの機能(秘密の見つけ・Dependabot)と、開いている通知の件数",
    collect: security,
  },
  {
    name: "drills",
    about: "訓練と点検の結果(戻す訓練・ファズ・ZAP・契約テスト・点検・脆弱性の検査・証跡の収集)",
    collect: drills,
  },
];
