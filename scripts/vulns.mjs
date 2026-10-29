// 脆弱性の精査の漏れ: Dependabot の開いている通知と、記録(docs/security/vulns.md)を突き合わせる。
//   pnpm vulns            精査していない通知・見直す日が来た記録・書き方の問題を出す
//   pnpm vulns --strict   上のどれかがあれば 1 で終わる(点検で)
// 通知は gh で読む(gh api repos/{owner}/{repo}/dependabot/alerts)。gh が無い・ログインしていない・権限が無いときは
// 落とさずに「確かめられなかった」と出し、記録の側だけを見る。
// 届く・まだ直していない穴は、記録ではなく非公開の Security Advisory の下書きに置く(公開のリポジトリなので)。
// 下書きの本文に勧告の ID があれば「精査済み(非公開)」として数える。決まりは docs/guides/vulnerabilities.md。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { todayInTokyo } from "./checkup/phase.mjs";
import { parseVulns, triage } from "./vulns-lib.mjs";

const FILE = "docs/security/vulns.md";
const strict = process.argv.includes("--strict");
const today = todayInTokyo();

/** gh api を呼び、1行に1つの JSON を配列にする。失敗したら { error } */
const ghLines = (path, jq) => {
  try {
    const out = execFileSync("gh", ["api", "--paginate", path, "--jq", jq], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      items: out
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l)),
    };
  } catch (e) {
    const reason = String(e.stderr || e.message || e)
      .trim()
      .split("\n")[0];
    return { error: reason };
  }
};

const alertsResult = ghLines(
  "repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100",
  ".[] | {number, ghsa: .security_advisory.ghsa_id, cve: .security_advisory.cve_id, pkg: .dependency.package.name, scope: .dependency.scope, severity: .security_advisory.severity, url: .html_url}",
);
const draftsResult = alertsResult.error
  ? { items: [] }
  : ghLines(
      "repos/{owner}/{repo}/security-advisories?state=draft&per_page=100",
      ".[] | {summary, description}",
    );

const { rows, problems } = parseVulns(readFileSync(FILE, "utf8").replaceAll("\r\n", "\n"));
const result = triage({
  rows,
  alerts: alertsResult.error ? undefined : alertsResult.items,
  drafts: draftsResult.items ?? [],
  today,
});

const showAlert = (a) =>
  `#${a.number} ${a.ghsa ?? ""}${a.cve ? ` / ${a.cve}` : ""} ${a.pkg}(${a.severity}・${a.scope ?? "?"})${a.url ? ` … ${a.url}` : ""}`;

console.log(`記録 ${rows.length}行を読みました(${FILE})`);
if (alertsResult.error) {
  console.log(`\n⚠️ Dependabot の通知を確かめられませんでした: ${alertsResult.error}`);
  console.log(
    "   gh が入っているか・gh auth login 済みか・リポジトリの Dependabot alerts を読める権限があるかを見てください。",
  );
} else {
  console.log(`Dependabot の開いている通知: ${alertsResult.items.length}件`);
  if (draftsResult.error)
    console.log(`⚠️ 非公開の下書きを確かめられませんでした(${draftsResult.error})`);
}

console.log(`\n🔴 まだ精査していない通知: ${result.untriaged.length}件(/cve で精査する)`);
for (const a of result.untriaged) console.log(`- ${showAlert(a)}`);

console.log(`\n🔒 非公開の下書きで扱っている通知: ${result.privately.length}件(期限までに直す)`);
for (const a of result.privately) console.log(`- ${showAlert(a)}`);

console.log(`\n📝 記録はあるが、開いたままの通知: ${result.recorded.length}件`);
for (const { alert, row } of result.recorded) {
  const next =
    row.result === "届く・直した"
      ? "直した版が入っているか確かめる"
      : "閉じるかを人に聞く(閉じるのは人の OK の後)";
  console.log(`- ${showAlert(alert)}`);
  console.log(`    記録: ${row.date} ${row.result} … ${FILE}:${row.line} → ${next}`);
}

console.log(
  `\n⏰ 見直す日が来た・過ぎた記録: ${result.due.length}件(/cve でもう一度精査し、行を足す)`,
);
for (const r of result.due)
  console.log(
    `- ${r.ids.join(" / ")} ${r.pkg} ${r.result}(見直す日 ${r.review}) … ${FILE}:${r.line}`,
  );

if (problems.length > 0) {
  console.log(`\n⚠️ 書き方の問題: ${problems.length}件`);
  for (const p of problems) console.log(`- ${FILE} ${p}`);
}

if (strict && (result.untriaged.length > 0 || result.due.length > 0 || problems.length > 0)) {
  console.log(
    "\n❌ 精査していない通知・見直す日が来た記録・書き方の問題があります。/cve で精査してください。",
  );
  process.exit(1);
}
