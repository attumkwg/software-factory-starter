// 費用の集め先(AWS の外): GitHub Actions の分数・AI(Anthropic の使用の金額)・そのほかの SaaS(手で書いた月額)・見積もり。
// どれも { ok: true, data } か { ok: false, message } を返す(読めなくても、ほかは集める)。
import { parse } from "yaml";
import { periodOf } from "./period.mjs";

export const SAAS_FILE = "docs/cost/saas.yaml";
export const ESTIMATES_FILE = "docs/cost/estimates.yaml";
/** Linux の標準の実行環境の、枠を超えた1分の値段(セント)。docs/guides/automation.md の「無料枠」 */
export const ACTIONS_CENTS_PER_MINUTE = 0.6;
const MAX_PAGES = 10;

const minutesOf = (r) => {
  const start = Date.parse(r.run_started_at ?? r.created_at);
  const end = Date.parse(r.updated_at);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? Math.ceil((end - start) / 60_000)
    : 0;
};

/** 非公開のリポジトリの、枠と使った分(公開なら null。枠が無い) */
function billing(ctx, repo) {
  if (repo?.private !== true) return null;
  const owner = ctx.repo.split("/")[0];
  const kind = repo?.owner?.type === "Organization" ? "orgs" : "users";
  const res = ctx.gh(`${kind}/${owner}/settings/billing/actions`);
  if (!res.ok) return null;
  const used = res.data?.total_minutes_used ?? 0;
  const included = res.data?.included_minutes ?? 0;
  const paid = res.data?.total_paid_minutes_used ?? Math.max(0, used - included);
  return { used, included, paid, paid_cents: Math.round(paid * ACTIONS_CENTS_PER_MINUTE) };
}

/** 今月の、ワークフローごとの実行の数と分数(実行の始まりから終わりまで。ジョブごとの請求の分とは少しずれる) */
export async function githubActions(ctx) {
  const repo = ctx.api("");
  if (!repo.ok) return { ok: false, message: `リポジトリの情報を読めなかった(${repo.message})` };
  const p = periodOf(ctx.today);
  const byName = {};
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = ctx.api(
      `actions/runs?per_page=100&page=${page}&created=${encodeURIComponent(`>=${p.monthStart}`)}`,
    );
    if (!res.ok) return { ok: false, message: `実行の一覧を読めなかった(${res.message})` };
    const runs = res.data?.workflow_runs ?? [];
    for (const r of runs) {
      const w = byName[r.name] ?? { runs: 0, minutes: 0 };
      byName[r.name] = { runs: w.runs + 1, minutes: w.minutes + minutesOf(r) };
    }
    if (runs.length < 100) break;
  }
  const workflows = Object.entries(byName)
    .map(([name, w]) => ({ name, ...w }))
    .sort((a, b) => b.minutes - a.minutes);
  return {
    ok: true,
    data: {
      private: repo.data?.private === true,
      workflows,
      minutes_total: workflows.reduce((a, w) => a + w.minutes, 0),
      billing: billing(ctx, repo.data),
    },
  };
}

const ANTHROPIC_COST_URL = "https://api.anthropic.com/v1/organizations/cost_report";

/**
 * 今月の AI の使用の金額(Anthropic の Usage and Cost API。管理用の鍵 ANTHROPIC_ADMIN_KEY があるときだけ。設計書 0019 の U-4)。
 * 金額はセントの小数の文字列で来る。日ごと・説明(モデルと種類)ごとに足す。鍵の値は投げる文にも入れない
 */
/** 1日ぶんの結果を足す(説明ごとの合計に足し、その日の合計を返す)。金額はセントの小数の文字列 */
function addBucket(bucket, byDescription) {
  let cents = 0;
  for (const r of bucket.results ?? []) {
    const c = Math.round(Number(r.amount ?? 0));
    cents += c;
    const name = r.description ?? r.model ?? "そのほか";
    byDescription[name] = (byDescription[name] ?? 0) + c;
  }
  return { date: String(bucket.starting_at).slice(0, 10), cents };
}

function costReportUrl(p, page) {
  const q = new URLSearchParams({
    starting_at: `${p.monthStart}T00:00:00Z`,
    ending_at: `${p.tomorrow}T00:00:00Z`,
    limit: "31",
  });
  q.append("group_by[]", "description");
  if (page) q.set("page", page);
  return `${ANTHROPIC_COST_URL}?${q}`;
}

export async function anthropicCost(ctx) {
  const key = ctx.env?.ANTHROPIC_ADMIN_KEY;
  if (!key)
    return { ok: false, message: "管理用の鍵が無い(ANTHROPIC_ADMIN_KEY。設計書 0019 の U-4)" };
  const p = periodOf(ctx.today);
  const byDescription = {};
  const days = [];
  let page;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await ctx.fetch(costReportUrl(p, page), {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok)
      return { ok: false, message: `Anthropic の使用の金額を読めなかった(HTTP ${res.status})` };
    const body = await res.json();
    for (const bucket of body.data ?? []) days.push(addBucket(bucket, byDescription));
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return {
    ok: true,
    data: {
      currency: "USD",
      total_cents: days.reduce((a, d) => a + d.cents, 0),
      by_description: byDescription,
      days,
    },
  };
}

/** 今月にかかっている SaaS(since 〜 until の間)。月額は円の整数で手で書く */
export async function saas(ctx) {
  const text = ctx.read(SAAS_FILE);
  if (text === undefined) return { ok: false, message: `${SAAS_FILE} が無い` };
  const { month } = periodOf(ctx.today);
  const active = (parse(text)?.items ?? [])
    .filter((i) => String(i?.since ?? "0000-00").slice(0, 7) <= month)
    .filter((i) => !i.until || String(i.until).slice(0, 7) >= month);
  const items = active
    .filter((i) => Number.isInteger(i.monthly_jpy))
    .map(({ name, what, monthly_jpy, category, bet, vendor }) => ({
      name,
      what,
      monthly_jpy,
      category: category ?? "other",
      bet: bet ?? "core",
      vendor: vendor ?? null,
    }));
  return {
    ok: true,
    data: {
      items,
      total_jpy: items.reduce((a, i) => a + i.monthly_jpy, 0),
      // 金額を書いていない物(公開のリポジトリなど)。ページに「金額なし」と名前だけ出す
      without_amount: active.filter((i) => !Number.isInteger(i.monthly_jpy)).map((i) => i.name),
    },
  };
}

/** 見積もり(段階の表。docs/concepts/stages.md の 4. が元)。今の段階の区分ごとの下と上(円) */
export async function estimates(ctx) {
  const text = ctx.read(ESTIMATES_FILE);
  if (text === undefined) return { ok: false, message: `${ESTIMATES_FILE} が無い` };
  const doc = parse(text) ?? {};
  const stage = (doc.stages ?? []).find((s) => s.id === doc.stage);
  if (!stage)
    return { ok: false, message: `${ESTIMATES_FILE} の stage「${doc.stage}」が stages に無い` };
  return {
    ok: true,
    data: { usd_jpy: doc.usd_jpy, stage: stage.id, name: stage.name, lines: stage.lines },
  };
}
