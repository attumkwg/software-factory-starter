// 週の数字(pnpm metrics)の計算。GitHub もファイルも読まない(集めるのは collect.mjs)。
// 決裁用(週ごとの並び。チームで1つの数)と改善用(先週の PR ごとの明細)を分けて出す。人ごとの数は出さない。
// 決まりは docs/designs/0035-delivery-metrics.md の 6(無人化率【推定】は docs/designs/0094-weekly-unmanned-rate.md)。
import { addDays, mondayOf, todayInTokyo } from "../checkup/phase.mjs";
import { loadPeopleConfig, prMinuteRange, QUESTION_MINUTES } from "../cost/source-people.mjs";
import { AI_LABEL } from "./ai-assisted.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 日時(ISO)か日付の、日本時間の週の月曜(日付の計算は scripts/checkup/phase.mjs の物を使う) */
export const weekOf = (at) => mondayOf(at.length === 10 ? at : todayInTokyo(new Date(at)));

/** today(日本時間の日付)から数えて、数え終わった週(今週は入れない)の月曜を古い順に n 個 */
export function fullWeeks(today, n) {
  const last = addDays(mondayOf(today), -7);
  return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)));
}

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);

// ── PR ──

/** 本文の「人に判断してほしい所」の表の行(人が答えた問い)。種類は2つ目の列。「なし」なら0 */
export function questionsOf(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const at = lines.findIndex((l) => /^##\s.*人に判断してほしい所/.test(l));
  if (at < 0) return { count: 0, kinds: [] };
  const kinds = [];
  for (const line of lines.slice(at + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.trim().startsWith("|") || /^\|[\s|:-]+\|?\s*$/.test(line.trim())) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (cells[0] === "#" || cells.every((c) => c === "")) continue;
    kinds.push(cells[1] || "(種類なし)");
  }
  return { count: kinds.length, kinds };
}

const isBotName = (s) => /\[bot\]/.test(String(s ?? ""));

/** 人が手で直したコミット(マージのコミット・ボット・AI の印つきを除く) */
export function humanCommits(commits, markers) {
  return commits.filter(
    (c) =>
      c.parents <= 1 &&
      !isBotName(c.authorName) &&
      !isBotName(c.authorEmail) &&
      !markers.some((m) => String(c.message ?? "").includes(m)),
  ).length;
}

// GraphQL の作った人(ボットは login に [bot] が付かない)を、費用のページの書き方(ボットは …[bot])に
const loginOf = (login, type) =>
  type === "Bot" && !isBotName(login) ? `${login}[bot]` : String(login ?? "");

/**
 * PR 1件の人の時間【推定】(docs/kit/roi.md の 2 と同じ式。費用のページと同じファイル(scripts/cost/source-people.mjs)の prMinuteRange)。
 * 名前は分を数えるのにだけ使い、持たない
 */
function minutesOf(pr, questions, config) {
  const author = loginOf(pr.author, pr.authorType);
  const shaped = {
    user: { login: author },
    labels: (pr.labels ?? []).map((name) => ({ name })),
    body: pr.body,
    comments: pr.comments ?? 0,
  };
  const reviews = (pr.reviewers ?? []).map((r) => ({ user: { login: loginOf(r.login, r.type) } }));
  return prMinuteRange(shaped, reviews, questions, config);
}

/**
 * PR 1件の事実(数えるのに要る物だけ。題名・本文・人の名前は持たない)。
 * config は docs/cost/people.yaml(loadPeopleConfig)。AI の印(ai_markers。人の手直しの見分け)と、無人化率の分に使う
 */
export function prFacts(pr, config = loadPeopleConfig("")) {
  const markers = config.ai_markers;
  const labels = pr.labels ?? [];
  const questions = questionsOf(pr.body);
  const { ai: aiAny, reviews, ...minutes } = minutesOf(pr, questions.count, config);
  return {
    number: pr.number,
    bot: pr.authorType === "Bot" || isBotName(pr.author),
    ai: labels.includes(AI_LABEL),
    risk: labels.find((l) => l.startsWith("risk:"))?.slice(5) ?? null,
    questions: questions.count,
    kinds: questions.kinds,
    humanCommits: humanCommits(pr.commits ?? [], markers),
    aiAny,
    comments: pr.comments ?? 0,
    reviews,
    minutes,
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    week: weekOf(pr.mergedAt),
    openToMergeHours: round1((Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / HOUR),
  };
}

// ── デプロイ・障害 ──

const OK = new Set(["SUCCESS", "INACTIVE"]); // INACTIVE は次のデプロイに替わった成功
const FAILED = new Set(["FAILURE", "ERROR"]);

/** 本番のデプロイ1件。終わっていない物(待ち・途中)は null */
export function deployFact(d) {
  const state = d.latestStatus ?? d.state;
  if (!OK.has(state) && !FAILED.has(state)) return null;
  return { at: d.createdAt, week: weekOf(d.createdAt), ok: OK.has(state) };
}

/** PR を開いてから、マージの後の最初の成功した本番のデプロイまで(時間)。まだ出ていなければ null */
export function leadTimeHours(pr, deploys) {
  const merged = Date.parse(pr.mergedAt);
  const first = deploys
    .filter((d) => d.ok && Date.parse(d.at) >= merged)
    .map((d) => Date.parse(d.at))
    .sort((a, b) => a - b)[0];
  return first === undefined ? null : round1((first - Date.parse(pr.createdAt)) / HOUR);
}

/** 振り返り(docs/incidents/YYYY-MM-DD-*.md)の「戻るまで: N分」「変更が原因: はい/いいえ」 */
export function incidentFact(file, text) {
  const date = file.split("/").pop().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const minutes = String(text).match(/^-\s*戻るまで:\s*(\d+)\s*分/m);
  const change = String(text).match(/^-\s*変更が原因:\s*(はい|いいえ)/m);
  return {
    file,
    date,
    week: weekOf(date),
    minutes: minutes ? Number(minutes[1]) : null,
    change: change ? change[1] === "はい" : null,
  };
}

// ── 仕様の在庫 ──

/** 仕様の状態(「> 状態:」の行)。日付は行の最初の YYYY-MM-DD */
export function specFact(file, text) {
  const number = file.split("/").pop().slice(0, 4);
  const status = String(text).match(/^>\s*状態:\s*(.+)$/m)?.[1] ?? "";
  const title =
    String(text)
      .match(/^#\s*仕様:\s*(.+)$/m)?.[1]
      ?.trim() ?? "";
  const state = /^完了/.test(status)
    ? "完了"
    : /^承認済み/.test(status)
      ? "承認済み"
      : /^下書き/.test(status)
        ? "下書き"
        : "その他";
  return { number, title, state, since: status.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null };
}

/**
 * 在庫: 承認済みで、まだ作っていない仕様(完了でなく、仕様・設計書・ADR・場面・賭けの外から番号が指されていない)と、
 * 承認待ち(下書き)。referenced はその外から指されている番号
 */
export function specInventory(specs, referenced, today) {
  const age = (s) => (s.since ? Math.round((Date.parse(today) - Date.parse(s.since)) / DAY) : null);
  const row = (s) => ({ number: s.number, title: s.title, days: age(s) });
  return {
    ready: specs.filter((s) => s.state === "承認済み" && !referenced.has(s.number)).map(row),
    drafts: specs.filter((s) => s.state === "下書き").map(row),
  };
}

// ── 無人化率【推定】 ──

const pctOf = (minutes, byHand) =>
  Math.min(100, Math.max(0, Math.round((1 - minutes / byHand) * 100)));

/**
 * 無人化率 = 1 − 人が使った工数 ÷ 全部を人が書いたらの工数(docs/kit/roi.md の 2 と同じ式)。
 * prs は prFacts の並び(ボットの PR も入れる。分は people.yaml の決まった目安なので【推定】)。
 * 幅: 人の工数の上の端(問い1つ × 5分を足す)で低い方、下の端で高い方。分母は問いの分を足さない(roi.md と同じ)。
 * PR・問い・コメント・レビュー・人の手直しの数は【実測】(手直しは式に入らない。数だけ並べる)。
 * 人と AI の PR が無い週(ボットだけ・PR なし)は —(ボットの PR は分子にも分母にも 5分で入り、率を下げる側)
 */
export function unmannedOf(prs) {
  const people = prs.filter((p) => !p.bot);
  const ai = people.filter((p) => p.aiAny);
  const low = sum(prs.map((p) => p.minutes.low));
  const high = sum(prs.map((p) => p.minutes.high));
  const byHand = sum(prs.map((p) => p.minutes.byHand));
  return {
    prs: { ai: ai.length, human: people.length - ai.length, bot: prs.length - people.length },
    questions: sum(prs.map((p) => p.questions)),
    comments: sum(people.map((p) => p.comments)),
    reviews: sum(prs.map((p) => p.reviews ?? 0)),
    humanCommits: sum(ai.map((p) => p.humanCommits)),
    hours: { low: round1(low / 60), high: round1(high / 60) },
    byHandHours: round1(byHand / 60),
    pct:
      people.length > 0 && byHand > 0
        ? { low: pctOf(high, byHand), high: pctOf(low, byHand) }
        : null,
  };
}

/** 無人化率の式に使った分(画面の注に出す。people.yaml の minutes と、問い1つの分) */
export const unmannedRule = (config) => ({
  ...config.minutes,
  question: config.minutes.question ?? QUESTION_MINUTES,
});

// ── まとめ ──

function weekRow(week, { prs, deploys, incidents }) {
  const merged = prs.filter((p) => p.week === week && !p.bot);
  const ai = merged.filter((p) => p.ai);
  const untouched = ai.filter((p) => p.questions === 0 && p.humanCommits === 0);
  const tried = deploys.filter((d) => d.week === week);
  const inWeek = incidents.filter((i) => i.week === week);
  const failures = tried.filter((d) => !d.ok).length + inWeek.filter((i) => i.change).length;
  return {
    week,
    deploys: tried.filter((d) => d.ok).length,
    leadTimeHours: median(merged.map((p) => p.leadTimeHours)),
    changeFailurePct: pct(failures, tried.length),
    restoreMinutes: median(inWeek.map((i) => i.minutes)),
    merged: merged.length,
    botMerged: prs.filter((p) => p.week === week && p.bot).length,
    aiPct: pct(ai.length, merged.length),
    aiUntouchedPct: pct(untouched.length, ai.length),
    unmanned: unmannedOf(prs.filter((p) => p.week === week)),
  };
}

/** 改善用の、問いの種類ごとの数(多い順) */
function kindCounts(prs) {
  const counts = new Map();
  for (const k of prs.flatMap((p) => p.kinds)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => ({ kind, count }));
}

/**
 * 週の数字。prs は prFacts の並び(マージした PR)・deploys は deployFact・incidents は incidentFact・
 * inventory は specInventory の結果。weeks は fullWeeks の並び(最後が先週)
 */
export function buildReport({
  prs,
  deploys,
  incidents,
  inventory,
  weeks,
  today,
  notes = [],
  config = loadPeopleConfig(""),
}) {
  const withLead = prs.map((p) => ({ ...p, leadTimeHours: leadTimeHours(p, deploys) }));
  const lastWeek = weeks.at(-1);
  const last = withLead.filter((p) => p.week === lastWeek && !p.bot);
  return {
    today,
    weeks: { from: weeks[0], to: lastWeek },
    decision: {
      weeks: weeks.map((w) => weekRow(w, { prs: withLead, deploys, incidents })),
      unmanned: {
        ...unmannedOf(withLead.filter((p) => weeks.includes(p.week))),
        rule: unmannedRule(config),
      },
      specsReady: inventory.ready.length,
      specsDraft: inventory.drafts.length,
    },
    improvement: {
      week: lastWeek,
      prs: last.map(
        ({ kinds: _kinds, createdAt: _c, mergedAt: _m, week: _w, minutes: _n, ...p }) => p,
      ),
      kinds: kindCounts(last),
      incidents: incidents.filter((i) => i.week === lastWeek),
      specs: inventory,
    },
    notes,
  };
}
