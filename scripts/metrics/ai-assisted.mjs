// AI が手伝った PR の見分け方(設計書 0035 の 6)。PR の本文と作った人だけを見る(コミットからは見分けない)。
// ai-label.yml が PR を開いた・本文を直したときにこれを流し、当たればラベル ai:assisted を付ける。数えるのはラベル(pnpm metrics)。
//   printf '%s' "$PR_BODY" | node scripts/metrics/ai-assisted.mjs --author <login>   → assisted=true|false
// 依存は使わない(ワークフローで pnpm install をしないため。node の標準だけ)。
import { readFileSync } from "node:fs";

/** AI が手伝った PR のラベル(.github/labels.yml) */
export const AI_LABEL = "ai:assisted";
/** 本文の印の正(費用のページと同じ。docs/cost/people.yaml の ai_markers) */
export const PEOPLE_FILE = "docs/cost/people.yaml";
const DEFAULT_MARKERS = ["Generated with [Claude Code]", "Co-Authored-By: Claude"];
/** AI のボットが作った PR(claude.yml など) */
const AI_AUTHORS = ["claude[bot]"];

/** people.yaml の ai_markers の並び(「ai_markers:」の下の「- "…"」の行)。読めなければ既定 */
export function aiMarkersOf(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const at = lines.findIndex((l) => /^ai_markers:\s*$/.test(l));
  if (at < 0) return DEFAULT_MARKERS;
  const markers = [];
  for (const line of lines.slice(at + 1)) {
    const m = line.match(/^\s+-\s+(["'])(.+)\1\s*(#.*)?$/);
    if (!m) break;
    markers.push(m[2]);
  }
  return markers.length > 0 ? markers : DEFAULT_MARKERS;
}

/** 本文に印がある・AI のボットが作った PR なら true */
export const isAiAssisted = ({ body, author, markers }) =>
  AI_AUTHORS.includes(String(author ?? "")) ||
  markers.some((mark) => String(body ?? "").includes(mark));

if (import.meta.main) {
  const at = process.argv.indexOf("--author");
  const author = at >= 0 ? process.argv[at + 1] : "";
  const body = readFileSync(0, "utf8");
  let peopleText = "";
  try {
    peopleText = readFileSync(PEOPLE_FILE, "utf8");
  } catch {
    // 無ければ既定の印
  }
  const assisted = isAiAssisted({ body, author, markers: aiMarkersOf(peopleText) });
  console.log(`assisted=${assisted}`);
}
