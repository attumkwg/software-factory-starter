// pnpm kpi --roi [--weeks <1〜26。既定 8>] [--prs <gh pr list の JSON のファイル>]
//   ① 賭けごとの原価の累計・資産の候補の PR の数・ROI の幅(roiRange)と合計
//   ② PR の「動かす KPI」が空・賭けと合わない PR の一覧(数え終わった週の窓の中)
//   ③ 北極星(届いて使われた数 ÷ 人の工数)の週ごとの分子と分母
// マージした PR を gh で読む(読むだけ。--prs なら手元のファイル)。出すのは番号・賭けの ID・数だけ(人の名前・題名・本文は出さない)。
// 毎週月曜に metrics.yml が Actions の要約に出す。決まりは docs/guides/kpi.md の 10・12・仕様 0094。
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { idOfFile, parseBet } from "./bets-lib.mjs";
import { todayInTokyo } from "./checkup/phase.mjs";
import { loadPeopleConfig, PEOPLE_FILE } from "./cost/source-people.mjs";
import {
  betFactOf,
  kpiMismatches,
  northStarWeeks,
  perTenHours,
  prFactOf,
  roiTotals,
  sinceOf,
} from "./roi-lib.mjs";

const BETS = "docs/product/bets";
const KPI = "docs/product/kpi.yaml";
const LIMIT = 1000;
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

const argOf = (argv, name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

const readBetFiles = () =>
  existsSync(BETS)
    ? readdirSync(BETS)
        .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
        .map((f) => ({ id: idOfFile(f), bet: parseBet(read(join(BETS, f))) }))
    : [];

// マージした PR(since 以降)。読めなければ { error }
function loadPrs(argv, since) {
  const file = argOf(argv, "--prs");
  if (file) return { prs: JSON.parse(readFileSync(file, "utf8")) };
  const fields = "number,author,labels,body,comments,reviews,mergedAt";
  const r = spawnSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "merged",
      "--limit",
      String(LIMIT),
      "--search",
      `merged:>=${since}`,
      "--json",
      fields,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) return { error: (r.stderr || r.error?.message || "").trim() };
  return { prs: JSON.parse(r.stdout || "[]") };
}

const fixed = (n) => (Number.isFinite(n) ? n.toFixed(1) : "回収しない");
const days = (r) => `${r.low.toFixed(1)}〜${r.high.toFixed(1)}`;

function roiLines(roi) {
  const out = [
    "### 資産の累計と ROI(賭けごと)",
    "",
    "| 賭け | 段階 | PR | うち資産の候補 | 原価の累計(人日)【推定】 | 経った月数 | ROI の幅【推定】 | 回収の月数 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of roi.rows) {
    const tail = r.why
      ? `— | ${r.why} | —`
      : `${r.months.toFixed(1)} | ${fixed(r.roiLow)}〜${fixed(r.roiHigh)} 倍 | ${fixed(r.paybackLow)}〜${fixed(r.paybackHigh)} か月`;
    out.push(`| ${r.id} | ${r.stage} | ${r.prs} | ${r.assets} | ${days(r.cost)} | ${tail} |`);
  }
  out.push("");
  out.push(
    roi.total
      ? `- 合計(ROI を出せた賭け): **${fixed(roi.total.roiLow)}〜${fixed(roi.total.roiHigh)} 倍**【推定】`
      : "- 合計: まだ出せない(rollout 以降で、得る物の見込みと PR のある賭けが無い)",
  );
  out.push(`- 土台の PR(賭けの外)の原価: ${days(roi.core)} 人日【推定】(ROI には入れない)`);
  return out;
}

function starLines(star) {
  const out = [
    "### 北極星: 届いて使われた数 ÷ 人の工数(数え終わった週)",
    "",
    "| 週(月曜) | 分子: 届いて使われた賭け【実測】 | PR | 分母: 人の時間【推定】 |",
    "|---|---|---|---|",
  ];
  for (const r of star.rows)
    out.push(`| ${r.monday} | ${r.used} | ${r.prs} | ${days(r.hours)} 時間 |`);
  const t = star.total;
  const per = perTenHours(t.used, t.hours);
  out.push(`| **合計** | **${t.used}** | **${t.prs}** | **${days(t.hours)} 時間** |`);
  out.push("");
  out.push(`- 10時間あたり: ${per ? `${per.low}〜${per.high}` : "—(人の時間が0)"}`);
  return out;
}

function mismatchLines(list) {
  const out = ["### PR の「動かす KPI」が空・賭けと合わない(数え終わった週の窓)", ""];
  if (list.length === 0) return [...out, "- なし"];
  const empty = list.filter((m) => m.reason === "空");
  if (empty.length > 0)
    out.push(`- 空: ${empty.length} 本(${empty.map((m) => `#${m.number}`).join("・")})`);
  for (const m of list.filter((x) => x.reason !== "空"))
    out.push(`- #${m.number}${m.bet ? `(${m.bet})` : ""}: ${m.reason}`);
  return out;
}

/** pnpm kpi --roi の入口。終わりの番号を返す */
export function runRoi(argv) {
  const weeks = Number(argOf(argv, "--weeks") ?? 8);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) {
    console.log("--weeks は 1〜26");
    return 1;
  }
  const today = todayInTokyo();
  const betFiles = readBetFiles();
  const loaded = loadPrs(argv, sinceOf(betFiles, today, weeks));
  if (loaded.error !== undefined) {
    console.log(`マージした PR を読めなかった(${loaded.error})。gh にログインしているか確かめる`);
    return 1;
  }
  const config = loadPeopleConfig(read(PEOPLE_FILE));
  const stages = Object.fromEntries(betFiles.map(({ id, bet }) => [id, bet.stage]));
  const prs = loaded.prs.filter((p) => p.mergedAt).map((p) => prFactOf(p, { config, stages }));
  const bets = betFiles.map(({ id, bet }) => betFactOf(id, bet));
  const records = parse(read(KPI) || "{}")?.records ?? [];
  const star = northStarWeeks({ bets, prs, records, today, weeks });
  const inWindow = prs.filter(
    (p) => p.week >= star.rows[0].monday && p.week <= star.rows.at(-1).monday,
  );
  const lines = [
    `## 資産の累計・ROI・北極星(${today}。pnpm kpi --roi)`,
    "",
    `> 【実測】PR の数・マージした週・KPI の記録 /【推定】人の時間(PR × docs/cost/people.yaml の分。幅の上は問い1つ × 5分を足す)・得る物の見込み。金額は出さない(docs/kit/roi.md)。`,
    "",
    ...roiLines(roiTotals(bets, prs, today)),
    "",
    ...starLines(star),
    "",
    ...mismatchLines(kpiMismatches(inWindow, bets)),
  ];
  if (loaded.prs.length >= LIMIT)
    lines.push("", `⚠️ PR が ${LIMIT} 件を超えた。古い PR は数えていない`);
  console.log(lines.join("\n"));
  return 0;
}
