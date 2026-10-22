// w-vuln: 重い脆弱性が開いたままになっていないか。pnpm vulns と同じ突き合わせ(scripts/vulns-lib.mjs)を使う。
// 緑は「精査していない通知」と「届く・まだ直していない(非公開の下書きで扱っている)通知」が両方0件のときだけ。
// 公開のリポジトリなので、件数と見る場所だけを出す(勧告の ID・パッケージの名前は出さない)。
import { parseVulns, triage } from "../../vulns-lib.mjs";
import { unknownFrom } from "../gh.mjs";

export const RECORD = "docs/security/vulns.md";
const WHERE = "pnpm vulns と /cve で見る";

/** 見回り(vuln-scan.yml。Trivy・OSV)の main での最後の実行が赤か */
const scanIsRed = (ctx) => {
  const runs = ctx.api("actions/workflows/vuln-scan.yml/runs?branch=main&per_page=1");
  return runs.ok && runs.data?.workflow_runs?.[0]?.conclusion === "failure";
};

const toAlert = (a) => ({
  number: a.number,
  ghsa: a.security_advisory?.ghsa_id,
  cve: a.security_advisory?.cve_id,
});

export async function check(ctx) {
  const alerts = ctx.api("dependabot/alerts?state=open&per_page=100");
  if (!alerts.ok) return unknownFrom(alerts, "Dependabot の通知");
  const drafts = ctx.api("security-advisories?state=draft&per_page=100");
  const { rows } = parseVulns((ctx.read(RECORD) ?? "").replaceAll("\r\n", "\n"));
  const r = triage({
    rows,
    alerts: (alerts.data ?? []).map(toAlert),
    drafts: drafts.ok ? (drafts.data ?? []) : [],
    today: ctx.today,
  });
  const counts = `精査していない ${r.untriaged.length}件・届く・まだ直していない ${r.privately.length}件・見直す日が来た記録 ${r.due.length}件`;
  if (r.privately.length > 0) return { result: "fail", note: `${counts}(${WHERE})` };
  if (r.untriaged.length > 0 && drafts.ok) return { result: "fail", note: `${counts}(${WHERE})` };
  if (r.untriaged.length > 0)
    return {
      result: "unknown",
      note: `${counts}。非公開の下書きを読めず、精査済みかが分からない(${WHERE})`,
    };
  if (scanIsRed(ctx))
    return { result: "fail", note: `見回り(vuln-scan)の最後の実行が赤。${counts}(Actions で見る)` };
  return { result: "pass", note: counts };
}
