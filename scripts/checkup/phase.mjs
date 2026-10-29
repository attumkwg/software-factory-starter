// 段階(立ち上げ〜2年)と日付の計算。段階は使い始めた日からの経過日数で決める(暦の月ではない)。
// 決まりは docs/designs/0007-checkup.md の 6.「段階」。

/** 段階の順(いちばん前が立ち上げ)。from は使い始めた日からの日数 */
export const PHASES = [
  { id: "setup", name: "立ち上げ", from: 0 },
  { id: "1m", name: "1か月", from: 30 },
  { id: "3m", name: "3か月", from: 90 },
  { id: "6m", name: "半年", from: 180 },
  { id: "1y", name: "1年", from: 365 },
  { id: "2y", name: "2年", from: 730 },
];

/** 間隔の日数(once は一度きり) */
export const EVERY_DAYS = {
  once: undefined,
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  "half-year": 182,
  yearly: 365,
};

const DAY = 24 * 60 * 60 * 1000;
const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");

/** 「2026-10-22」の形か(正規表現は使わない。Semgrep の regex_dos に当たらないように) */
export const isDate = (s) => {
  const [y, m, d, ...rest] = String(s).split("-");
  return rest.length === 0 && y?.length === 4 && m?.length === 2 && d?.length === 2
    ? isDigits(y) && isDigits(m) && isDigits(d)
    : false;
};

/** YAML が日付を Date に読んでも、文字列でも、「YYYY-MM-DD」にそろえる */
export const toDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));

const ms = (date) => Date.parse(`${toDate(date)}T00:00:00Z`);

/** b - a の日数 */
export const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);

/** date に n 日足した日 */
export const addDays = (date, n) => new Date(ms(date) + n * DAY).toISOString().slice(0, 10);

/** その日付の週の月曜(日付だけ。週は月曜始まり。packages/shared の time.ts の mondayOf と同じ数え方) */
export const mondayOf = (date) => addDays(date, -((new Date(ms(date)).getUTCDay() + 6) % 7));

/** 日本時間の今日(毎週の知らせは日本時間の朝に流れるので、UTC の日付だと前の日になる) */
export const todayInTokyo = (now = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);

const indexOf = (id) => PHASES.findIndex((p) => p.id === id);

/**
 * 使い始めた日と今日から、今の段階・経過日数・次の段階とその始まりの日を出す。
 * 使い始めた日より前なら立ち上げとして扱う(day は 0 より小さくなる)。
 */
export function phaseOf(startedOn, today) {
  const days = daysBetween(startedOn, today);
  let current = PHASES[0];
  for (const p of PHASES) if (days >= p.from) current = p;
  const next = PHASES[indexOf(current.id) + 1];
  return {
    phase: current,
    days,
    next: next ? { ...next, on: addDays(startedOn, next.from) } : undefined,
  };
}

/** その段階に、もう入っているか(前の段階の項目は残り続ける。飛ばして次に行かない) */
export const reached = (phaseId, currentId) => {
  const i = indexOf(phaseId);
  return i >= 0 && i <= indexOf(currentId);
};

/** 段階の名前 */
export const phaseName = (id) => PHASES.find((p) => p.id === id)?.name ?? id;
