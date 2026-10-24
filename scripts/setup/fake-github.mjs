// テスト用の偽物の GitHub(makeGitHub と同じ形)。状態を持ち、書けば変わる(--apply の後に読み直して 0件になるかを見るため)。
// 書いた呼び出しは calls に残る(秘密を書いていないか・消していないかを見る)。

const notFound = { ok: false, status: 404, message: "Not Found" };
const done = (data = null) => ({ ok: true, status: 200, data });

function baseState() {
  return {
    repo: {
      full_name: "acme/app",
      created_at: "2026-11-01T00:00:00Z",
      visibility: "public",
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: true,
      allow_auto_merge: false,
      delete_branch_on_merge: false,
      allow_update_branch: false,
      security_and_analysis: {
        secret_scanning: { status: "disabled" },
        secret_scanning_push_protection: { status: "disabled" },
        dependabot_security_updates: { status: "disabled" },
      },
    },
    me: { login: "alice", id: 1 },
    users: { 1: "alice" },
    labels: [{ name: "bug", color: "d73a4a", description: "Something isn't working" }],
    vulnerabilityAlerts: false,
    pvr: false,
    actions: {
      "actions/permissions/workflow": {
        default_workflow_permissions: "write",
        can_approve_pull_request_reviews: true,
      },
      "actions/permissions": { enabled: true, allowed_actions: "all", sha_pinning_required: false },
      "actions/permissions/fork-pr-contributor-approval": {
        approval_policy: "first_time_contributors",
      },
      "actions/permissions/artifact-and-log-retention": { days: 90 },
    },
    rulesets: [],
    environments: {},
    variables: {},
    secrets: [],
    envSecrets: {},
  };
}

/** 状態を変えて、空の成功を返す */
const mut = (fn) => (s, m, b) => {
  fn(s, m, b);
  return done();
};

const ROUTES = [
  [/^$/, { GET: (s) => done(s.repo), PATCH: (s, _m, b) => patchRepo(s, b) }],
  [/^labels\?/, { GET: (s) => done(s.labels) }],
  [/^labels$/, { POST: mut((s, _m, b) => s.labels.push(b)) }],
  [/^labels\/(.+)$/, { PATCH: (s, m, b) => patchLabel(s, decodeURIComponent(m[1]), b) }],
  [
    /^vulnerability-alerts$/,
    {
      GET: (s) => (s.vulnerabilityAlerts ? done() : notFound),
      PUT: mut((s) => {
        s.vulnerabilityAlerts = true;
      }),
      DELETE: mut((s) => {
        s.vulnerabilityAlerts = false;
      }),
    },
  ],
  [
    /^private-vulnerability-reporting$/,
    {
      GET: (s) => done({ enabled: s.pvr }),
      PUT: mut((s) => {
        s.pvr = true;
      }),
      DELETE: mut((s) => {
        s.pvr = false;
      }),
    },
  ],
  [
    /^(actions\/permissions(?:\/[\w-]+)?)$/,
    {
      GET: (s, m) => done(s.actions[m[1]]),
      PUT: mut((s, m, b) => {
        s.actions[m[1]] = { ...s.actions[m[1]], ...b };
      }),
    },
  ],
  [
    /^rulesets\?/,
    { GET: (s) => done(s.rulesets.map(({ id, name, target }) => ({ id, name, target }))) },
  ],
  [/^rulesets$/, { POST: mut((s, _m, b) => s.rulesets.push({ id: s.rulesets.length + 1, ...b })) }],
  [
    /^rulesets\/(\d+)$/,
    {
      GET: (s, m) => done(s.rulesets.find((r) => r.id === Number(m[1]))),
      PUT: (s, m, b) => putRuleset(s, Number(m[1]), b),
    },
  ],
  [
    /^environments\?/,
    { GET: (s) => done({ environments: Object.values(s.environments).map((e) => e.env) }) },
  ],
  [/^environments\/([\w-]+)$/, { PUT: (s, m, b) => putEnv(s, m[1], b) }],
  [
    /^environments\/([\w-]+)\/deployment-branch-policies(?:\?.*)?$/,
    {
      GET: (s, m) => done({ branch_policies: s.environments[m[1]].policies }),
      POST: (s, m, b) => addPolicy(s, m[1], b),
    },
  ],
  [
    /^environments\/([\w-]+)\/deployment-branch-policies\/(\d+)$/,
    { DELETE: (s, m) => dropPolicy(s, m[1], Number(m[2])) },
  ],
  [
    /^environments\/([\w-]+)\/secrets$/,
    { GET: (s, m) => done({ secrets: (s.envSecrets[m[1]] ?? []).map((name) => ({ name })) }) },
  ],
  [
    /^actions\/variables\/(\w+)$/,
    {
      GET: (s, m) =>
        m[1] in s.variables ? done({ name: m[1], value: s.variables[m[1]] }) : notFound,
      PATCH: mut((s, m, b) => {
        s.variables[m[1]] = b.value;
      }),
    },
  ],
  [
    /^actions\/variables$/,
    {
      POST: mut((s, _m, b) => {
        s.variables[b.name] = b.value;
      }),
    },
  ],
  [/^actions\/secrets$/, { GET: (s) => done({ secrets: s.secrets.map((name) => ({ name })) }) }],
];

function patchRepo(s, b) {
  const { security_and_analysis: sa, ...rest } = b;
  Object.assign(s.repo, rest);
  if (sa) Object.assign(s.repo.security_and_analysis, sa);
  return done(s.repo);
}

function patchLabel(s, name, b) {
  const l = s.labels.find((x) => x.name === name);
  if (!l) return notFound;
  Object.assign(l, { name: b.new_name ?? l.name, color: b.color, description: b.description });
  return done(l);
}

function putRuleset(s, id, b) {
  const at = s.rulesets.findIndex((r) => r.id === id);
  s.rulesets[at] = { id, ...b };
  return done();
}

function putEnv(s, name, b) {
  const reviewers = (b.reviewers ?? []).map((r) => ({
    type: r.type,
    reviewer: { id: r.id, login: s.users[r.id] },
  }));
  const rules = reviewers.length
    ? [{ type: "required_reviewers", prevent_self_review: b.prevent_self_review, reviewers }]
    : [];
  const policies = s.environments[name]?.policies ?? [];
  s.environments[name] = {
    env: { name, deployment_branch_policy: b.deployment_branch_policy, protection_rules: rules },
    policies,
  };
  return done();
}

function addPolicy(s, name, b) {
  const e = s.environments[name];
  e.policies.push({ id: e.policies.length + 1, ...b });
  return done();
}

function dropPolicy(s, name, id) {
  const e = s.environments[name];
  e.policies = e.policies.filter((p) => p.id !== id);
  return done();
}

/** 偽物を作る。change(state) で最初の状態を変えられる */
export function fakeGitHub(change = () => {}) {
  const state = baseState();
  change(state);
  const calls = [];
  const route = (method, sub, body) => {
    for (const [re, handlers] of ROUTES) {
      const m = sub.match(re);
      if (m && handlers[method]) return handlers[method](state, m, body);
    }
    return { ok: false, status: 404, message: `偽物に無い: ${method} ${sub}` };
  };
  return {
    state,
    calls,
    repo: state.repo.full_name,
    get: (sub) => route("GET", sub),
    getPath: (path) => {
      if (path === "user") return done(state.me);
      // キットの最後のコミット(state.kitUpdatedAt があれば1件)
      if (/^repos\/[^/]+\/[^/]+\/commits\?/.test(path))
        return done(
          state.kitUpdatedAt ? [{ commit: { committer: { date: state.kitUpdatedAt } } }] : [],
        );
      const m = path.match(/^users\/(.+)$/);
      if (!m) return notFound;
      const id = 100 + Object.keys(state.users).length;
      state.users[id] = m[1];
      return done({ login: m[1], id });
    },
    write: (method, sub, body) => {
      calls.push({ method, sub, body });
      return route(method, sub, body);
    },
  };
}
