// 週の数字の集め先。GitHub(マージした PR・本番のデプロイ)は gh の GraphQL で読むだけ。
// リポジトリのファイル(障害の振り返り・仕様・コード)は ctx.read / ctx.files(scripts/checkup/context.mjs)で読む。
// gh(path, vars) は { ok, data } か { ok: false, message } を返す(テストでは偽物)。
import { execFileSync } from "node:child_process";
import { readEnv } from "../checkup/gh.mjs";

/** gh api graphql(読むだけ)。CHECKUP_READ_TOKEN があればそれで読む(点検と同じ) */
export function ghGraphql(query, vars) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars))
    args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  try {
    const out = execFileSync("gh", args, {
      encoding: "utf8",
      env: readEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, data: JSON.parse(out).data };
  } catch (e) {
    if (e.code === "ENOENT") return { ok: false, message: "gh が入っていない" };
    return {
      ok: false,
      message: String(e.stderr || e.message)
        .trim()
        .split("\n")[0],
    };
  }
}

const PRS = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number createdAt mergedAt body
      author { login __typename }
      labels(first: 30) { nodes { name } }
      commits(first: 100) { nodes { commit {
        message parents { totalCount } author { name email }
      } } }
    } }
  }
}`;

/** since(YYYY-MM-DD)から後にマージした PR。max を超えたら切る(truncated) */
export function collectPrs(gh, repo, since, max) {
  const prs = [];
  let after = null;
  let total = 0;
  while (prs.length < max) {
    const res = gh(PRS, {
      q: `repo:${repo} is:pr is:merged merged:>=${since}`,
      ...(after ? { after } : {}),
    });
    if (!res.ok) return { ok: false, message: `マージした PR を読めなかった(${res.message})` };
    const s = res.data.search;
    total = s.issueCount;
    prs.push(...s.nodes.filter((n) => n.number !== undefined).map(toPr));
    if (!s.pageInfo.hasNextPage) break;
    after = s.pageInfo.endCursor;
  }
  return { ok: true, prs: prs.slice(0, max), truncated: total > max };
}

const toPr = (n) => ({
  number: n.number,
  createdAt: n.createdAt,
  mergedAt: n.mergedAt,
  body: n.body,
  author: n.author?.login ?? null,
  authorType: n.author?.__typename ?? null,
  labels: n.labels.nodes.map((l) => l.name),
  commits: n.commits.nodes.map(({ commit: c }) => ({
    message: c.message,
    parents: c.parents.totalCount,
    authorName: c.author?.name ?? null,
    authorEmail: c.author?.email ?? null,
  })),
});

const DEPLOYS = `query($owner: String!, $name: String!, $env: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    deployments(environments: [$env], first: 100, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { createdAt state latestStatus { state } }
    }
  }
}`;

/** environment(既定 prod)のデプロイのうち、since から後の物(新しい順に読み、古くなったら止める) */
export function collectDeploys(gh, repo, environment, since) {
  const [owner, name] = repo.split("/");
  const out = [];
  let after = null;
  for (;;) {
    const res = gh(DEPLOYS, { owner, name, env: environment, ...(after ? { after } : {}) });
    if (!res.ok) return { ok: false, message: `本番のデプロイを読めなかった(${res.message})` };
    const d = res.data.repository.deployments;
    const nodes = d.nodes.map((n) => ({
      createdAt: n.createdAt,
      state: n.state,
      latestStatus: n.latestStatus?.state ?? null,
    }));
    out.push(...nodes.filter((n) => n.createdAt >= since));
    if (!d.pageInfo.hasNextPage || nodes.some((n) => n.createdAt < since)) break;
    after = d.pageInfo.endCursor;
  }
  return { ok: true, deploys: out };
}

/** 振り返りのファイル(docs/incidents/YYYY-MM-DD-*.md) */
export const incidentFiles = (ctx) =>
  ctx
    .files("docs/incidents")
    .filter((f) => /\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(f))
    .map((file) => ({ file, text: ctx.read(file) ?? "" }));

/** 仕様のファイル(docs/specs/NNNN-*.md) */
export const specFiles = (ctx) =>
  ctx
    .files("docs/specs")
    .filter((f) => /\/\d{4}-[^/]+\.md$/.test(f))
    .map((file) => ({ file, text: ctx.read(file) ?? "" }));

/** git が持っているファイル(node_modules・作った物を読まない) */
export function trackedFiles(root = process.cwd()) {
  try {
    return execFileSync("git", ["ls-files"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

const TEXT = /\.(m?[jt]sx?|ya?ml|md|tf|sql)$/;
// 作る前に書く・作る予定を書く所(ここから指されても、作ったことにならない)
const PLANS = /^docs\/(specs|designs|adr|scenarios|product)\//;
const REFERENCE = /(?:specs|designs)\/(\d{4})-|(?:仕様|設計書)\s*(\d{4})/g;

/** 仕様・設計書・ADR・場面・賭けの外(コード・手引き・手順書・スキル)で、仕様か設計書の番号を指している物 */
export function referencedSpecs(files, read) {
  const found = new Set();
  for (const file of files.filter((f) => TEXT.test(f) && !PLANS.test(f))) {
    for (const m of (read(file) ?? "").matchAll(REFERENCE)) found.add(m[1] ?? m[2]);
  }
  return found;
}
