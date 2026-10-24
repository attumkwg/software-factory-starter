// PR の変更が、重い検査(結合・E2E・イメージ・移行・API の互換・VRT)を要るかを決める(docs/guides/ci-speed.md)。
//   要らない = 変えたのが文書だけ(下の LIGHT に全部当たる)。迷う物は「要る」に倒す(許可リスト。知らない場所は要る)。
//   PR 以外(main への push・マージキュー)・差分が取れない・差分が空 → 要る。
// 省いたジョブも「成功」を返すので、必須のチェックは止まらない。ここを広げると検査が飛ぶので、.github/** = 危険度「高」。
//
// 使い方(ジョブの中。checkout は fetch-depth: 2 で、PR の合わせたコミットの1つ目の親 = 元(base)と比べる):
//   node .github/scripts/ci-scope.mjs "$GITHUB_EVENT_NAME" >> "$GITHUB_OUTPUT"   → heavy=true|false(理由は標準エラーに)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 重い検査が読まない場所。画面に入る規約の本文(apps/web/src/legal/**/*.md)と、結合テストが読む権限の表(docs/authz)は入れない
const LIGHT = [/^docs\/(?!authz\/)/, /^(?!apps\/|packages\/)(?:[^/]+\/)*[^/]+\.md$/];

export function needsHeavy(files) {
  if (files.length === 0) return true;
  return files.some((file) => !LIGHT.some((pattern) => pattern.test(file)));
}

function changedFiles() {
  // --no-renames: 名前を変えたら、元の名前(消えた側)も数える(apps/ から docs/ への移しを文書だけと見ない)
  const out = execFileSync("git", ["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"], {
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

function decide(eventName) {
  if (eventName !== "pull_request") return { heavy: true, why: "PR ではない" };
  let files;
  try {
    files = changedFiles();
  } catch {
    return { heavy: true, why: "差分が取れない" };
  }
  const heavy = needsHeavy(files);
  return { heavy, why: heavy ? "文書の外を変えた" : `文書だけ(${files.length}件)` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { heavy, why } = decide(process.argv[2]);
  console.error(`重い検査: ${heavy ? "流す" : "省く"}(${why})`);
  console.log(`heavy=${heavy}`);
}
