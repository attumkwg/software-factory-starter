// 点検の中身: 確かめ方を読み込み、いまの段階の項目を選び、auto を確かめる。CLI は run.mjs。
// 確かめ1つが落ちても全体は止めず、その項目を unknown にする(設計書 8.「壊れたとき」)。
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { phaseOf, toDate } from "./phase.mjs";
import { selectItems } from "./todo.mjs";

export const CHECKS_DIR = join(import.meta.dirname, "checks");

/** checks/ の確かめ方を全部読む(ファイル名 = 名前)。Map<名前, check(ctx)> */
export async function loadChecks(dir = CHECKS_DIR) {
  const checks = new Map();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .sort();
  for (const f of files) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    if (typeof mod.check === "function") checks.set(basename(f, ".mjs"), mod.check);
  }
  return checks;
}

const firstLine = (e) =>
  String(e?.message ?? e)
    .trim()
    .split("\n")[0];

/** 確かめ1つを流す。投げても unknown にする。同じ確かめは1回だけ流す(memo) */
async function runOne(name, checks, ctx, memo) {
  if (memo.has(name)) return memo.get(name);
  const fn = checks.get(name);
  let r;
  try {
    r = fn ? await fn(ctx) : { result: "unknown", note: `確かめ方「${name}」が無い` };
  } catch (e) {
    r = { result: "unknown", note: `確かめの途中で落ちた(${firstLine(e)})` };
  }
  memo.set(name, r);
  return r;
}

/**
 * 点検を1回流す。
 * 戻り値: { today, phase, days, next, results: [{ item, result, note, regressed }], ask, manual, advisor, snoozed, done }
 *   regressed … 台帳では done なのに、確かめたら fail(守りが外れた)
 */
export async function runCheckup({ ledger, checks, ctx, today, area }) {
  const startedOn = toDate(ledger.started_on);
  const { phase, days, next } = phaseOf(startedOn, today);
  const selected = selectItems(ledger, phase.id, today, { area });
  const memo = new Map();
  const results = [];
  for (const item of selected.checks) {
    const r = await runOne(item.check, checks, ctx, memo);
    results.push({
      item,
      result: r.result,
      note: r.note,
      regressed: item.status === "done" && r.result === "fail",
    });
  }
  const { ask, manual, advisor, snoozed, done } = selected;
  return {
    today,
    startedOn,
    phase,
    days,
    next,
    area,
    results,
    ask,
    manual,
    advisor,
    snoozed,
    done,
  };
}

/** 急ぎ(severity: high の fail)だけ */
export const urgentOf = (run) =>
  run.results.filter((r) => r.result === "fail" && r.item.severity === "high");

/** JSON で出す形(知らせ・ほかの道具が読む) */
export function toJson(run) {
  const ids = (items) => items.map((i) => i.id);
  return {
    today: run.today,
    area: run.area ?? null,
    started_on: run.startedOn,
    phase: run.phase.id,
    days: run.days,
    next: run.next ? { phase: run.next.id, on: run.next.on } : null,
    results: run.results.map((r) => ({
      id: r.item.id,
      severity: r.item.severity,
      result: r.result,
      note: r.note,
      regressed: r.regressed,
    })),
    ask: ids(run.ask),
    manual: ids(run.manual),
    advisor: ids(run.advisor),
    snoozed: ids(run.snoozed),
    done: ids(run.done),
  };
}
