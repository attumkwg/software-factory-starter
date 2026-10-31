// PR の題名・本文・コミットの文に、個人情報の形が無いかを見る(Issue #205)。読むだけ。依存は要らない(node の標準と gh だけ)。
//   CI: pr-work.yml(必須のチェック「取り組みと作業の種類(PR の本文)」)が、PR でもマージキューの中でも、今の PR を API で読み直して流す
//   手元で: GH_REPO=owner/repo PR_NUMBER=12 node .github/scripts/pr-text-pii.mjs
// 見つけた値はログに出さない(CI のログは公開)。種類・場所・伏せた形だけを出す
import { execFileSync } from "node:child_process";
import { hitLines, prTexts, scanTexts } from "./text-pii-lib.mjs";

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
const number = Number(process.env.PR_NUMBER);
if (!repo || !(number > 0)) {
  process.stderr.write("::error::GH_REPO(か GITHUB_REPOSITORY)と PR_NUMBER を渡してください\n");
  process.exit(2);
}

const gh = (args) =>
  JSON.parse(
    execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  );
const pull = gh([`repos/${repo}/pulls/${number}`]);
// PR のコミット(元の枝..PR の枝)。API が返すのは 250件まで
const commits = gh([
  "--paginate",
  "--slurp",
  `repos/${repo}/pulls/${number}/commits?per_page=100`,
]).flat();

const hits = scanTexts(prTexts({ pull, commits }));
if (hits.length === 0) {
  process.stdout.write(
    `✅ PR #${number} の題名・本文・コミットの文(${commits.length}件)に、個人情報の形は無い\n`,
  );
  process.exit(0);
}
const head = `PR #${number} の題名・本文・コミットの文に、個人情報の形が ${hits.length} 個ある(値はログに出さない)`;
process.stdout.write(
  [
    `❌ ${head}`,
    ...hitLines(hits).map((l) => `  ${l}`),
    "  直し方: 題名・本文は PR の画面で消す。コミットの文は書き直して(rebase)枝を出し直すか、PR を閉じて新しい枝で出し直す",
    "  テストの値なら、予約のドメイン(example.com・○○.test)か、.github/scripts/text-pii-lib.mjs の許す一覧の偽の値を使う",
    "  本物の値なら、書いた時点で公開されている。消したうえで docs/runbooks/personal-data-breach.md で判定する",
    `::error::${head}`,
    "",
  ].join("\n"),
);
process.exit(1);
