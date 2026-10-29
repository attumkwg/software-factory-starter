// 週の数字(DORA の4つ・AI が手伝った PR の割合・人の介在率・無人化率【推定】・仕様の在庫・引き渡し)。metrics.yml が毎週(KIT_ROLE=product)流す。
//   pnpm metrics                        先週までの8週を Markdown で出す(gh のログインで読む)
//   pnpm metrics --weeks 12             週の数(1〜26)
//   pnpm metrics --environment prod     本番の Environment の名前(既定 prod。deploy.yml の environment)
//   pnpm metrics --today 2026-10-26     この日の時点で数える(前の週を出し直す。既定は今日・日本時間)
//   pnpm metrics --out <dir>            <dir>/metrics.json と metrics.md に書く(画面には出さない)
// 読むだけ。人の名前・PR の題名と本文は出さない(数と PR の番号と仕様の番号・題だけ)。
// 決まり: docs/designs/0035-delivery-metrics.md(無人化率は 0094)・手引き: docs/guides/metrics.md
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAcceptance } from "../acceptance-lib.mjs";
import { makeContext } from "../checkup/context.mjs";
import { resolveRepo } from "../checkup/gh.mjs";
import { addDays, isDate, todayInTokyo } from "../checkup/phase.mjs";
import { loadPeopleConfig } from "../cost/source-people.mjs";
import { aiMarkersOf, PEOPLE_FILE } from "./ai-assisted.mjs";
import {
  acceptanceFiles,
  collectDeploys,
  collectMergedAt,
  collectPrs,
  designFiles,
  ghGraphql,
  incidentFiles,
  referencedSpecs,
  specFiles,
  trackedFiles,
} from "./collect.mjs";
import { acceptanceFact, buildHandoff, implementationPrs, reworkFacts } from "./handoff.mjs";
import {
  buildReport,
  deployFact,
  fullWeeks,
  incidentFact,
  prFacts,
  specFact,
  specInventory,
} from "./lib.mjs";
import { renderMarkdown } from "./render.mjs";

/** 1回に読む PR の上限(GitHub の検索は 1000 件まで) */
const MAX_PRS = 1000;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

/** 引き渡し(実装の完了 → 受け入れ・設計が原因の作り直し)。設計書 0077 */
export function collectHandoff({ ctx, gh, weeks }) {
  const files = acceptanceFiles(ctx);
  const prsOf = new Map(files.map((f) => [f.path, implementationPrs(f.text)]));
  const rounds = readAcceptance(files).rounds.filter((r) => r.date >= weeks[0]);
  const wanted = [...new Set(rounds.filter((r) => r.no === 1).flatMap((r) => prsOf.get(r.path)))];
  const mergedAt =
    ctx.repo && wanted.length > 0 ? collectMergedAt(gh, ctx.repo, wanted) : new Map();
  const facts = rounds.map((r) => acceptanceFact(r, prsOf.get(r.path), mergedAt));
  return buildHandoff(weeks, {
    rounds: facts,
    rework: reworkFacts(designFiles(ctx)),
    unreadPrs: wanted.filter((n) => !mergedAt.has(n)),
  });
}

/** GitHub とファイルから集めて、週の数字にする(gh は ghGraphql。テストでは偽物) */
export function collectReport({ ctx, gh, files, weeksCount, environment }) {
  const weeks = fullWeeks(ctx.today, weeksCount);
  const markers = aiMarkersOf(ctx.read(PEOPLE_FILE));
  const config = loadPeopleConfig(ctx.read(PEOPLE_FILE));
  // 検索の日付は UTC。日本時間の月曜 0:00 は前の日の 15:00(UTC)なので、1日前から読んで週で絞る
  const since = addDays(weeks[0], -1);
  const notes = [];
  let prs = [];
  let deploys = [];
  if (!ctx.repo)
    notes.push("リポジトリが分からない(gh repo view が通らない)。PR とデプロイは数えていない");
  else {
    const p = collectPrs(gh, ctx.repo, since, MAX_PRS);
    if (p.ok)
      prs = p.prs.map((pr) => prFacts(pr, markers, config)).filter((pr) => pr.week >= weeks[0]);
    else notes.push(p.message);
    if (p.truncated)
      notes.push(`マージした PR が ${MAX_PRS} 件を超えた(古い週の数が少ない。--weeks を減らす)`);
    const d = collectDeploys(gh, ctx.repo, environment, since);
    if (d.ok) deploys = d.deploys.map(deployFact).filter(Boolean);
    else notes.push(d.message);
  }
  const incidents = incidentFiles(ctx)
    .map(({ file, text }) => incidentFact(file, text))
    .filter(Boolean);
  const unwritten = incidents.filter((i) => i.minutes === null || i.change === null).length;
  if (unwritten > 0)
    notes.push(
      `振り返り ${unwritten}件に「戻るまで」か「変更が原因」の行が無い(docs/runbooks/incident.md の 6)`,
    );
  const inventory = specInventory(
    specFiles(ctx).map(({ file, text }) => specFact(file, text)),
    referencedSpecs(files, ctx.read),
    ctx.today,
  );
  const { notes: handoffNotes, ...handoff } = collectHandoff({ ctx, gh, weeks });
  const report = buildReport({
    prs,
    deploys,
    incidents,
    inventory,
    weeks,
    today: ctx.today,
    notes,
    config,
  });
  return { ...report, handoff, notes: [...report.notes, ...handoffNotes] };
}

if (import.meta.main) {
  const weeksCount = Number(option("--weeks", "8"));
  if (!Number.isInteger(weeksCount) || weeksCount < 1 || weeksCount > 26)
    fail("--weeks は 1〜26 の整数です");
  const today = option("--today", todayInTokyo());
  if (!isDate(today)) fail("--today は YYYY-MM-DD です");
  const ctx = makeContext({ repo: resolveRepo(), today });
  const report = collectReport({
    ctx,
    gh: ghGraphql,
    files: trackedFiles(),
    weeksCount,
    environment: option("--environment", "prod"),
  });
  const markdown = renderMarkdown(report);
  const out = option("--out");
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "metrics.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(out, "metrics.md"), markdown);
    console.log(
      `週の数字を作りました(PR ${report.improvement.prs.length}件・読めなかった物 ${report.notes.length}件)→ ${join(out, "metrics.md")}`,
    );
  } else process.stdout.write(markdown);
}
