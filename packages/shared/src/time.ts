import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 時刻(docs/adr/0005-money-and-time.md)。時刻には3種類あり、持ち方が違う。
//
//   ある瞬間   … 作った時刻・ログインした時刻。UTC で持つ("2026-10-18T01:23:45.000Z"・DB は timestamptz)
//   日付だけ   … 期限・誕生日・締め日。時間帯を持たない("2026-10-18"・DB は date)。
//                **UTC の0時にしない**(日本の 10/18 0:00 は UTC では 10/17 15:00 で、1日ずれる)
//   土地の時計 … 「毎朝9時に通知」・営業時間。時刻+時間帯の名前で持つ("09:00"+"Asia/Tokyo")。UTC に直さない
//
// どの時間帯で見せるか・「1日」をどこで区切るかは、組織の時間帯(tenants.time_zone)で決める。
// ─────────────────────────────────────────────────────────────────────────────

/** ある瞬間。UTC(末尾 Z)だけを受け付ける("+09:00" 付きは受け付けない=どこかで直し忘れた印)。 */
export const InstantSchema = z.iso.datetime();
/** 日付だけ(YYYY-MM-DD)。 */
export const DateOnlySchema = z.iso.date();
/** 時間帯の名前(IANA。"Asia/Tokyo")。"+09:00" や "JST" ではなく名前で持つ(夏時間の国でも正しく動く)。 */
export const TimeZoneSchema = z.string().refine(isValidTimeZone, "時間帯の名前が正しくありません");

export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

export function isValidTimeZone(name: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** ある瞬間 → その時間帯での日付("2026-10-18")。日ごとに分けるとき・「今日」を決めるときに。 */
export function toLocalDate(instant: Date | string, timeZone: string): string {
  const parts = partsIn(new Date(instant), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * その時間帯での1日の範囲 [start, end)(どちらも瞬間)。DB で「その日に作られた物」を探すときに。
 * 夏時間の国では、1日が23時間・25時間になる日がある(end - start が24時間とは限らない)。
 */
export function localDayRange(date: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = DateOnlySchema.parse(date).split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    start: zonedMidnight(y, m, d, timeZone),
    end: zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
  };
}

// ── 中身 ──

const pad = (n: number) => String(n).padStart(2, "0");

function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** その時間帯で y-m-d 0:00 になる瞬間。時差を引いてから、夏時間の境目なら1回だけ直す。 */
function zonedMidnight(y: number, m: number, d: number, timeZone: string): Date {
  const wall = Date.UTC(y, m - 1, d);
  const offsetAt = (t: number) => {
    const p = partsIn(new Date(t), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  };
  let guess = wall - offsetAt(wall);
  const corrected = wall - offsetAt(guess);
  if (corrected !== guess) guess = corrected;
  return new Date(guess);
}
