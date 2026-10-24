// pnpm setup:labels: ラベルの手引き(docs/guides/labels.md)を .github/labels.yml から作り直す。
import { writeFileSync } from "node:fs";
import { loadConfig, validateLabels } from "./config.mjs";
import { LABELS_GUIDE, renderLabelsGuide } from "./labels-doc.mjs";

const { labels } = loadConfig();
const problems = validateLabels(labels);
if (problems.length > 0) {
  console.error(`❌ ラベルの一覧の書き方の問題: ${problems.length}件`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
writeFileSync(LABELS_GUIDE, renderLabelsGuide(labels));
console.log(`${LABELS_GUIDE} を .github/labels.yml から作り直しました(${labels.length}件)`);
