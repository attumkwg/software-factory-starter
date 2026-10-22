// checks/ のいくつかが使う、GitHub への問い合わせ。読むだけ。
import { unknownFrom } from "./gh.mjs";

/** Renovate の PR を新しい順に検索する(最大100件)。extra は検索の条件の足し(「is:open」など) */
export const renovatePrs = (ctx, extra) => {
  const q = `repo:${ctx.repo} is:pr author:app/renovate ${extra}`.trim();
  return ctx.gh(`search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=100`);
};

/**
 * ワークフロー(.github/workflows/<file>)が一度でも成功したか。
 * since(YYYY-MM-DD)を渡すと、その日より後の成功だけを数える。
 */
export function workflowSucceeded(ctx, file, label, since) {
  const created = since ? `&created=%3E${since}` : "";
  const res = ctx.api(`actions/workflows/${file}/runs?status=success&per_page=1${created}`);
  if (!res.ok && res.status === 404)
    return { result: "fail", note: `${label}のワークフロー(${file})が無い` };
  if (!res.ok) return unknownFrom(res, `${label}の実行の記録`);
  const last = res.data?.workflow_runs?.[0];
  return last
    ? { result: "pass", note: `${label}の最後の成功: ${String(last.created_at).slice(0, 10)}` }
    : { result: "fail", note: `${label}が成功した記録が無い(Actions → ${file})` };
}
