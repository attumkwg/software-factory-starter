// セットアップの全体: 区分ごとに差分を作り(plan)、--apply なら順に流し(apply)、結果を Markdown にする(render)。
// GitHub は gh(github.mjs。テストでは偽物)で読む。決まり: docs/designs/0014-setup-before-use.md
import {
  planActions,
  planLabels,
  planRepository,
  planSecrets,
  planSecurity,
  planVariable,
} from "./areas-basic.mjs";
import { planEnvironments } from "./areas-environments.mjs";
import { planRuleset } from "./areas-ruleset.mjs";
import { roleOf } from "./config.mjs";
import { isDiff, unknown } from "./entries.mjs";
import { nextSteps } from "./next-steps.mjs";

const AREAS = [
  planLabels,
  planRepository,
  planSecurity,
  planActions,
  planRuleset,
  planEnvironments,
  planVariable,
  planSecrets,
];

/** 区分を全部読む。リポジトリそのものが読めなければ、そこで止める(管理者でない・名前が違う) */
export function plan({ gh, setup, labels, src }) {
  const repo = gh.get("");
  if (!repo.ok) return { error: unknown(`リポジトリ ${gh.repo} `, repo).text };
  const meRes = gh.getPath("user");
  const me = meRes.ok ? { login: meRes.data.login, id: meRes.data.id } : undefined;
  const role = roleOf(setup, repo.data.full_name);
  const ctx = { repoData: repo.data, role, me };
  const areas = AREAS.map((area) => area({ gh, setup, labels, ctx }));
  return { repo: repo.data.full_name, role, me, areas, steps: nextSteps({ setup, role, src, me }) };
}

/** 差分を並びの順に流す。1つ失敗してもほかは続ける。戻り値: [{ text, ok, message }] */
export function apply(result) {
  const done = [];
  for (const area of result.areas)
    for (const e of area.entries.filter(isDiff)) {
      const res = e.apply();
      done.push({
        text: `${area.title}: ${e.text}`,
        ok: res.ok,
        message: res.ok ? "" : `HTTP ${res.status}: ${res.message}`,
      });
    }
  return done;
}

export const countDiffs = (result) => result.areas.flatMap((a) => a.entries).filter(isDiff).length;

const MARK = { add: "➕", change: "✏️", remove: "➖", extra: "ℹ️", skip: "⏭", unknown: "⚠️" };

function renderArea(area) {
  const okCount = area.entries.filter((e) => e.state === "ok").length;
  const rest = area.entries.filter((e) => e.state !== "ok" && e.state !== "todo");
  const lines = [`### ${area.title}${okCount ? `(✅ ${okCount}件そろっている)` : ""}`];
  if (rest.length === 0 && okCount > 0)
    lines.push(
      `- ✅ ${area.entries
        .filter((e) => e.state === "ok")
        .map((e) => e.text)
        .join("・")}`,
    );
  for (const e of rest) lines.push(`- ${MARK[e.state]} ${e.text}`);
  return lines;
}

const ROLE_TEXT = {
  template: "ひな形(定期の運用は動かない。KIT_ROLE=template)",
  product: "使う側(定期の運用が動く。KIT_ROLE=product)",
};

const appliedLine = (a) => `- ${a.ok ? "✅" : "❌"} ${a.text}${a.ok ? "" : `(${a.message})`}`;

/** 結果を Markdown に。applied があれば反映の結果も */
export function render(result, { applying = false, applied = [] } = {}) {
  const diffs = countDiffs(result);
  const lines = [
    `## GitHub のセットアップ${applying ? "" : "(試し: 何も書き換えていない)"}: ${result.repo}`,
    "",
    `- 役割: ${ROLE_TEXT[result.role]}`,
    `- 打った人: ${result.me ? `@${result.me.login}` : "分からない(gh api user が通らない)"}`,
    "",
  ];
  for (const area of result.areas) lines.push(...renderArea(area), "");
  const todos = [
    ...result.areas.flatMap((a) => a.entries.filter((e) => e.state === "todo")),
    ...result.steps,
  ];
  if (todos.length > 0) lines.push("### 人がやること", ...todos.map((e) => `- [ ] ${e.text}`), "");
  if (applied.length > 0) lines.push("### 反映した結果", ...applied.map(appliedLine), "");
  if (!applying)
    lines.push(
      diffs === 0
        ? "差分は 0件(そろっている)"
        : `差分は ${diffs}件。反映するなら pnpm setup:github --apply`,
    );
  return lines.join("\n");
}
