// 継続率(コホート)の計算(docs/designs/0022-usage-retention.md)。DB を読まない純粋な計算。
// 組織(か人)を「その機能を初めて使った週」でまとめ、N 週後もまだ使っているかを数える。
// 入力は週の日付だけ(組織と人の ID を持たない)。出すのも数と割合だけ。

/** これより少ない組は small(割合が大きく揺れる。設計書 0022 の 6) */
export const RETENTION_SMALL_BELOW = 5;

/** 1つの組織の、人ごとの「使った週(月曜の日付)」の一覧 */
export type TenantWeeks = readonly (readonly string[])[];

export type RetentionCell = {
  /** 始めた週から何週後か(1 から) */
  after: number;
  /** その週に使った数 */
  active: number;
  activePct: number;
  /** 1週後からその週まで、毎週使った数(「N 週続けて」) */
  continued: number;
  continuedPct: number;
};
export type RetentionCohort = {
  /** 始めた週(月曜) */
  start: string;
  size: number;
  small: boolean;
  after: RetentionCell[];
};
/** 組を足し合わせた行(N 週後まで届いた組だけを足す) */
export type RetentionOverall = RetentionCell & { size: number; small: boolean };
export type RetentionUnit = { overall: RetentionOverall[]; cohorts: RetentionCohort[] };

const DAY = 86_400_000;
// 週の番号は 1970-01-05(最初の月曜。1970-01-01 は木曜)から数える
const FIRST_MONDAY = 4;
const weekNo = (monday: string) =>
  Math.round((Date.parse(`${monday}T00:00:00Z`) / DAY - FIRST_MONDAY) / 7);
const mondayOfNo = (no: number) =>
  new Date((no * 7 + FIRST_MONDAY) * DAY).toISOString().slice(0, 10);
const pct = (n: number, size: number) => Math.round((n / size) * 100);

function cell(after: number, size: number, active: number, continued: number): RetentionCell {
  return {
    after,
    active,
    activePct: pct(active, size),
    continued,
    continuedPct: pct(continued, size),
  };
}

/** 1つの組(同じ週に始めた物)の、1週後から lastFull の週までの数 */
function cohortOf(start: number, members: ReadonlySet<number>[], lastFull: number) {
  const after: RetentionCell[] = [];
  let continuing = members;
  for (let n = 1; start + n <= lastFull; n += 1) {
    const week = start + n;
    continuing = continuing.filter((weeks) => weeks.has(week));
    const active = members.filter((weeks) => weeks.has(week)).length;
    after.push(cell(n, members.length, active, continuing.length));
  }
  const size = members.length;
  return { start: mondayOfNo(start), size, small: size < RETENTION_SMALL_BELOW, after };
}

/** N 週後ごとに、そこまで届いた組を足し合わせる */
function overallOf(cohorts: RetentionCohort[]): RetentionOverall[] {
  const rows: RetentionOverall[] = [];
  for (let n = 1; ; n += 1) {
    const reached = cohorts.filter((c) => c.after.length >= n);
    if (reached.length === 0) return rows;
    const sum = (pick: (c: RetentionCell) => number) =>
      reached.reduce((total, c) => total + pick(c.after[n - 1] as RetentionCell), 0);
    const size = reached.reduce((total, c) => total + c.size, 0);
    rows.push({
      ...cell(
        n,
        size,
        sum((c) => c.active),
        sum((c) => c.continued),
      ),
      size,
      small: size < RETENTION_SMALL_BELOW,
    });
  }
}

/** 使った週の集まり(組織か人)ごとの継続率。from より前に始めた物は数えない(始めた週が分からない) */
function unitOf(members: ReadonlySet<number>[], from: number, lastFull: number): RetentionUnit {
  const byStart = new Map<number, ReadonlySet<number>[]>();
  for (const weeks of members) {
    if (weeks.size === 0) continue;
    const start = Math.min(...weeks);
    if (start < from) continue;
    byStart.set(start, [...(byStart.get(start) ?? []), weeks]);
  }
  const cohorts = [...byStart.entries()]
    .sort(([x], [y]) => x - y)
    .map(([start, group]) => cohortOf(start, group, lastFull));
  return { overall: overallOf(cohorts), cohorts };
}

/**
 * 組織と人の継続率。組織は「組織の中の誰かが使った週」、人は「その人が使った週」で数える。
 * from … この週(月曜)から後に始めた組だけ。lastFull … 数え終わった最後の週(月曜。今週は途中なので入れない)。
 */
export function retention(
  tenants: readonly TenantWeeks[],
  range: { from: string; lastFull: string },
): { tenants: RetentionUnit; users: RetentionUnit } {
  const from = weekNo(range.from);
  const lastFull = weekNo(range.lastFull);
  const users = tenants.flatMap((t) => t.map((weeks) => new Set(weeks.map(weekNo))));
  const orgs = tenants.map((t) => new Set(t.flatMap((weeks) => weeks.map(weekNo))));
  return { tenants: unitOf(orgs, from, lastFull), users: unitOf(users, from, lastFull) };
}
