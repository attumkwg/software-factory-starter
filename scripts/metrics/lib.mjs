// 週の数字(pnpm metrics)の計算。GitHub もファイルも読まない(集めるのは collect.mjs)。
// 決裁用(週ごとの並び。チームで1つの数)と改善用(先週の PR ごとの明細)を分けて出す。人ごとの数は出さない。
// 決まりは docs/designs/0035-delivery-metrics.md の 6。
import { AI_LABEL } from "./ai-assisted.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JST = 9 * HOUR;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** 日時(ISO)か日付の、日本時間の週の月曜 */
export function weekOf(at) {
  const ms = Date.parse(at.length === 10 ? `${at}T00:00:00+09:00` : at) + JST;
  const back = (new Date(ms).getUTCDay() + 6) % 7; // 月曜 = 0
  return isoDay(ms - back * DAY);
}

/** today(日本時間の日付)から数えて、数え終わった週(今週は入れない)の月曜を古い順に n 個 */
export function fullWeeks(today, n) {
  const thisWeek = Date.parse(`${weekOf(today)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => isoDay(thisWeek - (n - i) * 7 * DAY));
}

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
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

/** PR 1件の事実(数えるのに要る物だけ。題名・本文・人の名前は持たない) */
export function prFacts(pr, markers) {
  const labels = pr.labels ?? [];
  const questions = questionsOf(pr.body);
  return {
    number: pr.number,
    bot: pr.authorType === "Bot" || isBotName(pr.author),
    ai: labels.includes(AI_LABEL),
    risk: labels.find((l) => l.startsWith("risk:"))?.slice(5) ?? null,
    questions: questions.count,
    kinds: questions.kinds,
    humanCommits: humanCommits(pr.commits ?? [], markers),
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
export function buildReport({ prs, deploys, incidents, inventory, weeks, today, notes = [] }) {
  const withLead = prs.map((p) => ({ ...p, leadTimeHours: leadTimeHours(p, deploys) }));
  const lastWeek = weeks.at(-1);
  const last = withLead.filter((p) => p.week === lastWeek && !p.bot);
  return {
    today,
    weeks: { from: weeks[0], to: lastWeek },
    decision: {
      weeks: weeks.map((w) => weekRow(w, { prs: withLead, deploys, incidents })),
      specsReady: inventory.ready.length,
      specsDraft: inventory.drafts.length,
    },
    improvement: {
      week: lastWeek,
      prs: last.map(({ kinds: _kinds, createdAt: _c, mergedAt: _m, week: _w, ...p }) => p),
      kinds: kindCounts(last),
      incidents: incidents.filter((i) => i.week === lastWeek),
      specs: inventory,
    },
    notes,
  };
}
