// 背景の AI(claude.yml)が開いた PR が多すぎるときは、新しく動かない(G-62・仕様 0063。G-135・仕様 0095 で見直し)。
// 上限は2つ:
//   ① 人を待つ本数(AI_OPEN_PR_LIMIT・既定 5): 人のレビュー・返事は増えないので、人を待つ PR が上限なら止める。
//      センサーだけで入れる所(setup.yml の ai_merge.sensors_only: true)では、人を呼ぶ理由(印・問い)がある PR だけを数える。
//      それ以外では、全部の PR が持ち主の返事を待つので全部を数える(今までどおり)。
//   ② 全部の本数(AI_OPEN_PR_TOTAL_LIMIT・既定 20): センサーで回る PR も、CI の同時の数と費用には効くので、全体にも天井を置く。
// 上限の数は claude.yml の env(設計書 0063 の U-1・設計書 0091)。

/** 人を待つ印(scripts/human-queue-lib.mjs の QUEUE_LABELS と同じ。依存を持たずに読むので写す。テストで突き合わせる) */
export const WAITING_LABELS = ["needs-human", "risk:high", "tests:weakened"];

/** 背景の AI が開いた PR か(作った人が Claude のアプリ)。手元の AI の PR は人が作って見ているので数えない */
export const isBackgroundAiPr = (pr) =>
  pr?.user?.type === "Bot" && String(pr.user.login ?? "").startsWith("claude");

/** HTML のコメント(<!-- -->)を外す(本文は人が書く物なので、正規表現でなく位置で切る) */
function stripComments(text) {
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("<!--", at);
    if (open < 0) return out + text.slice(at);
    out += text.slice(at, open);
    const close = text.indexOf("-->", open + 4);
    if (close < 0) return out;
    at = close + 3;
  }
}

/**
 * 本文の「🧑‍⚖️ 人に判断してほしい所」に問いの行があるか(見出しの次の表に、見出し・区切り・なし 以外の行)。
 * scripts/human-queue-lib.mjs の prQuestions と同じ見分け(依存を持たずに読むので写す。テストで突き合わせる)
 */
export function hasQuestions(body) {
  const lines = stripComments(String(body ?? "")).split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith("## ") && l.includes("🧑‍⚖️"));
  if (start < 0) return false;
  for (const line of lines.slice(start + 1)) {
    const t = line.trim();
    if (t.startsWith("## ")) return false;
    if (!t.startsWith("|") || !t.endsWith("|") || /^\|[\s:|-]*\|$/.test(t)) continue;
    if (t.includes("人が判断する問い")) continue;
    const cells = t
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c !== "" && c !== "なし");
    if (cells.length > 1 || (cells.length === 1 && !/^\d+$/.test(cells[0]))) return true;
  }
  return false;
}

/** 人を待つ PR か。sensorsOnly でなければ全部が持ち主の返事を待つ */
export const waitsOnHuman = (pr, sensorsOnly) =>
  !sensorsOnly ||
  (pr.labels ?? []).some((l) => WAITING_LABELS.includes(l?.name ?? l)) ||
  hasQuestions(pr.body);

/** 上限の数。数でなければ既定(fallback) */
export const limitOf = (text, fallback = 5) => {
  const n = Number(String(text ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** setup.yml の ai_merge.sensors_only(scripts/pr-merge-lib.mjs の sensorsOnlyFrom と同じ読み方) */
export function sensorsOnlyOf(setupYaml) {
  const lines = String(setupYaml ?? "").split("\n");
  const start = lines.findIndex((l) => /^ai_merge:\s*(#.*)?$/.test(l));
  if (start < 0) return false;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line)) return false;
    const m = line.match(/^\s+sensors_only:\s*(true|false)\b/);
    if (m) return m[1] === "true";
  }
  return false;
}

const numbers = (prs) => prs.map((pr) => `#${pr.number}`).join("・");

/**
 * 動かすか。理由の行つき。prs: 開いている PR(GitHub の pulls の形)・limit: 人を待つ本数の上限・
 * totalLimit: 全部の本数の上限・sensorsOnly: センサーだけで入れる所か
 */
export function judgeOpenPrs({ prs, limit, totalLimit = 20, sensorsOnly = false }) {
  const open = prs.filter(isBackgroundAiPr);
  const waiting = open.filter((pr) => waitsOnHuman(pr, sensorsOnly));
  const what = sensorsOnly ? "人を待つ PR" : "PR(全部が持ち主の返事を待つ)";
  if (waiting.length >= limit)
    return {
      ok: false,
      line: `背景の AI が開いた${what}が ${waiting.length} 本あり、上限(${limit} 本)に達しているので動かない(${numbers(waiting)})。答えるかレビューして閉じてから頼む(docs/guides/throughput.md)`,
    };
  if (open.length >= totalLimit)
    return {
      ok: false,
      line: `背景の AI が開いた PR が全部で ${open.length} 本あり、全体の上限(${totalLimit} 本)に達しているので動かない(${numbers(open)})。キューで入るのを待ってから頼む(docs/guides/throughput.md)`,
    };
  const list = open.length > 0 ? `(${numbers(open)})` : "";
  return {
    ok: true,
    line: `背景の AI が開いた PR は ${open.length} / ${totalLimit} 本・うち${sensorsOnly ? "人を待つ" : "返事を待つ"}のは ${waiting.length} / ${limit} 本${list}`,
  };
}
