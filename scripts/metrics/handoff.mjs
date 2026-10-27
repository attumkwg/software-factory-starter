// 週の数字の「引き渡し」(作る → 確かめる の継ぎ目)。GitHub もファイルも読まない(集めるのは collect.mjs と run.mjs)。
// 実装の完了から受け入れの開始までの日数・受け入れの点数と外れた理由・設計が原因の作り直しの割合。
// 決まりは docs/designs/0077-handoff-metrics.md の 6。人ごとの数は出さない(見た人は数えない)。
import { REASONS, scoreOf } from "../acceptance-lib.mjs";
import { median, weekOf } from "./lib.mjs";

const DAY = 86_400_000;
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");
const isDate = (s) =>
  s.length === 10 && s[4] === "-" && s[7] === "-" && isDigits(s.replaceAll("-", ""));

/** 受け入れの記録の頭の「実装の PR: #12, #13」から番号を取る */
export function implementationPrs(text) {
  const line = text.split("\n").find((l) => l.includes("実装の PR:"));
  if (!line) return [];
  return line
    .split("#")
    .slice(1)
    .map((s) => {
      let end = 0;
      while (end < s.length && isDigits(s[end])) end += 1;
      return s.slice(0, end);
    })
    .filter((n) => n !== "")
    .map(Number);
}

/** 日本時間の日付(YYYY-MM-DD) */
const tokyoDay = (iso) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);

/**
 * 受け入れの1回の事実。round は acceptance-lib の回・mergedAt は 番号 → マージの日時(ISO。無ければ undefined)。
 * 待ち(日)は第1回だけ: 第1回の日付 − 実装の PR のうち最後にマージした日。読めない PR があれば null
 */
export function acceptanceFact(round, prs, mergedAt) {
  const s = scoreOf(round);
  let waitDays = null;
  const merged = prs.map((n) => mergedAt.get(n));
  if (round.no === 1 && prs.length > 0 && merged.every(Boolean)) {
    const done = merged.map(tokyoDay).sort().at(-1);
    waitDays = Math.round((Date.parse(round.date) - Date.parse(done)) / DAY);
  }
  return {
    path: round.path,
    no: round.no,
    week: weekOf(round.date),
    waitDays,
    unread: round.no === 1 && merged.some((m) => !m),
    pdm: s.pdm,
    all: s.all,
    ok: round.items.filter((i) => i.result === "合").length,
    judged: round.items.filter((i) => i.result !== "未").length,
    reasons: s.reasons,
  };
}

// 「## 13. 作り直しの記録」の見出しから、次の「## 」の見出しまでの行
const reworkSection = (text) => {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("## ") && l.includes("作り直しの記録"));
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && l.startsWith("## "));
  return lines.slice(at + 1, end < 0 ? lines.length : end);
};

/** 設計書の「作り直しの記録」の行: [{ week, stage }]。日付が YYYY-MM-DD の行だけ */
export function reworkFacts(designs) {
  const out = [];
  for (const { text } of designs) {
    for (const raw of reworkSection(text)) {
      const line = raw.trim();
      if (!line.startsWith("|") || !line.endsWith("|")) continue;
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (isDate(cells[0] ?? "") && cells[2]) out.push({ week: weekOf(cells[0]), stage: cells[2] });
    }
  }
  return out;
}

/** 週ごとの引き渡しの数。weeks は fullWeeks の並び */
export function handoffWeeks(weeks, { rounds, rework }) {
  return weeks.map((week) => {
    const inWeek = rounds.filter((r) => r.week === week);
    const ok = inWeek.reduce((n, r) => n + r.ok, 0);
    const judged = inWeek.reduce((n, r) => n + r.judged, 0);
    const reasons = Object.fromEntries(
      REASONS.map((k) => [k, inWeek.reduce((n, r) => n + r.reasons[k], 0)]),
    );
    const re = rework.filter((r) => r.week === week);
    return {
      week,
      rounds: inWeek.length,
      waitDays: median(inWeek.map((r) => r.waitDays).filter((d) => d !== null)),
      acceptPct: pct(ok, judged),
      reasons,
      rework: re.length,
      designReworkPct: pct(re.filter((r) => r.stage === "設計").length, re.length),
    };
  });
}

/** 引き渡しの数をまとめる。lastWeek の回は改善用に1つずつ並べる */
export function buildHandoff(weeks, { rounds, rework, unreadPrs = [] }) {
  const lastWeek = weeks.at(-1);
  return {
    weeks: handoffWeeks(weeks, { rounds, rework }),
    last: rounds
      .filter((r) => r.week === lastWeek)
      .map(({ week: _w, ok: _o, judged: _j, unread: _u, ...r }) => r),
    notes:
      unreadPrs.length === 0
        ? []
        : [
            `受け入れの記録の実装の PR を読めなかった(${unreadPrs.map((n) => `#${n}`).join("・")})。待ちの日数に入れていない`,
          ],
  };
}
