// 人の時間の集め先。① 自動の目安: 今月作った PR を、本文の「取り組み」(賭けか土台)ごとに数え、1件あたりの分数を掛ける。
// ② 手入力・時給・売上は、非公開の置き場(S3 の cost/inputs/)から --inputs で渡されたフォルダを読む(リポジトリに置かない)。
// 時間はあくまで推定(人の評価には使わない)。設計: docs/designs/0020-people-time-and-bet-pl.md
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { checkPrBody, idOfFile, parseBet } from "../bets-lib.mjs";
import { periodOf } from "./period.mjs";

export const PEOPLE_FILE = "docs/cost/people.yaml";
export const BETS_DIR = "docs/product/bets";
/** 賭けの外の PR(保守・不具合・基盤・セキュリティ)の行き先 */
export const CORE = "core";
const PAGE = 100;

/** 設定(分数・AI の PR の見分け方・配り方)。無い項目は既定 */
export function loadPeopleConfig(text) {
  const doc = (text ? parse(text) : null) ?? {};
  return {
    minutes: {
      ai_pr_check: 15,
      human_pr: 120,
      bot_pr_check: 5,
      review: 20,
      comment: 3,
      ...doc.minutes,
    },
    ai_markers: doc.ai_markers ?? ["Generated with [Claude Code]", "Co-Authored-By: Claude"],
    allocation: doc.allocation ?? "people_auto",
    max_prs: doc.max_prs ?? 300,
  };
}

/** 賭けの ID → いまの段階(docs/product/bets/B-NNNN-*.md) */
export function betStages(ctx) {
  const stages = {};
  for (const file of ctx.files(BETS_DIR)) {
    const id = idOfFile(file.split("/").pop());
    if (id) stages[id] = parseBet(ctx.read(file) ?? "").stage;
  }
  return stages;
}

const isBot = (login) => String(login).endsWith("[bot]");
const add = (m, k, v) => {
  m[k] = (m[k] ?? 0) + v;
};

/** PR 1件の、人ごとの分数(作った人・レビューした人・コメント) */
export function prMinutes(pr, reviews, config) {
  const m = config.minutes;
  const author = pr.user?.login;
  const ai = config.ai_markers.some((mark) => String(pr.body ?? "").includes(mark));
  const out = {};
  if (isBot(author)) add(out, "(ボットの PR の確認)", m.bot_pr_check);
  else add(out, `@${author}`, ai ? m.ai_pr_check : m.human_pr);
  if (!isBot(author)) add(out, `@${author}`, (pr.comments ?? 0) * m.comment);
  for (const r of reviews.filter((r) => r.user?.login !== author && !isBot(r.user?.login)))
    add(out, `@${r.user.login}`, m.review);
  return { ai, minutes: out };
}

/** 今月作った PR を、賭けごとに数える(自動の目安) */
export async function peoplePrs(ctx) {
  const config = loadPeopleConfig(ctx.read(PEOPLE_FILE));
  const p = periodOf(ctx.today);
  const stages = betStages(ctx);
  const q = encodeURIComponent(`repo:${ctx.repo} is:pr created:>=${p.monthStart}`);
  const items = [];
  for (let page = 1; items.length < config.max_prs; page++) {
    const res = ctx.gh(`search/issues?q=${q}&per_page=${PAGE}&page=${page}`);
    if (!res.ok) return { ok: false, message: `PR の一覧を読めなかった(${res.message})` };
    items.push(...(res.data?.items ?? []));
    if ((res.data?.items ?? []).length < PAGE) break;
  }
  const prs = items.slice(0, config.max_prs).map((pr) => {
    const reviews = ctx.api(`pulls/${pr.number}/reviews?per_page=100`);
    const checked = checkPrBody(pr.body ?? "", { author: pr.user?.login ?? "", bets: stages });
    const betId = checked.work?.startsWith("bet:")
      ? checked.work.slice(4).trim().slice(0, 6)
      : null;
    return {
      number: pr.number,
      bet: betId ?? CORE,
      work: checked.work ?? null,
      kind: checked.kind ?? null,
      stage: checked.stage ?? null,
      proposal: checked.proposal ?? "費用",
      ...prMinutes(pr, reviews.ok ? (reviews.data ?? []) : [], config),
    };
  });
  return {
    ok: true,
    data: { month: p.month, config, truncated: items.length > config.max_prs, prs },
  };
}

/** 簡単な CSV(1行目が見出し・引用符なし)。行の物の並び */
export function parseCsv(text) {
  const [head, ...rows] = String(text ?? "")
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"));
  if (!head) return [];
  const keys = head.split(",").map((k) => k.trim());
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v.trim()])));
}

/**
 * 非公開の入力(--inputs のフォルダ。cost.yml が S3 の cost/inputs/ から落とす)。どれも無くてよい。
 *   rates.json   … { "default": 円/時, "people": { "@名前": 円/時 } }
 *   time.csv     … week_start,person,bet,percent,hours(週ごと・人ごとに、賭けの割合と、その週に働いた時間)
 *   revenue.csv  … month,bet,jpy(bet は B-NNNN か「全体」)
 */
export function readInputs(dir, month) {
  const read = (f) => (dir && existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
  const ratesText = read("rates.json");
  const time = parseCsv(read("time.csv"))
    .filter((r) => String(r.week_start).startsWith(month))
    .map((r) => ({
      person: r.person,
      bet: r.bet || CORE,
      hours: (Number(r.hours) * Number(r.percent)) / 100,
    }))
    .filter((r) => Number.isFinite(r.hours) && r.hours > 0);
  const revenue = parseCsv(read("revenue.csv"))
    .filter((r) => r.month === month)
    .map((r) => ({ bet: r.bet, jpy: Math.round(Number(r.jpy)) }))
    .filter((r) => Number.isFinite(r.jpy));
  return {
    rates: ratesText ? JSON.parse(ratesText) : null,
    time: read("time.csv") === null ? null : time,
    revenue: read("revenue.csv") === null ? null : revenue,
  };
}
