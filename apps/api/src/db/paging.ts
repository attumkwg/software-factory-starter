import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { badRequest } from "../errors.ts";

// 一覧のページング(docs/guides/api-changes.md「一覧は必ずページング」)。
//
// 並び順は (作った時刻, ID)。時刻が同じ行があっても、ID で必ず1通りに決まる。
// 続きの印は、ページの最後の行の (時刻, ID)。「その行より後ろ」を索引で探すので、何ページ目でも速い
// (OFFSET のように、前のページの行を数え直さない)。表には同じ並びの索引を張る(drizzle/concurrent/)。

/** 続きの印の中身。at は DB の精度(マイクロ秒)のままの時刻(JS の Date はミリ秒までなので使わない) */
export type Cursor = { at: string; id: string };

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const MICROS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

// 中身に頼らせないよう base64url にして渡す(監査ログと同じ)
export const encodeCursor = (c: Cursor) => Buffer.from(`${c.at}|${c.id}`).toString("base64url");

export function decodeCursor(cursor: string): Cursor {
  const [at = "", id = "", ...rest] = Buffer.from(cursor, "base64url").toString().split("|");
  // 形だけでなく、ありえる日時か(13月・2月30日を DB に渡して 500 にしない)
  const millis = `${at.slice(0, 23)}Z`;
  const valid =
    rest.length === 0 &&
    MICROS_TIME.test(at) &&
    UUID.test(id) &&
    !Number.isNaN(Date.parse(millis)) &&
    new Date(millis).toISOString() === millis;
  if (!valid) throw badRequest("続きの印が正しくありません");
  return { at, id };
}

/** 時刻の列を、続きの印に使う形(UTC・マイクロ秒まで)で読む */
export const cursorTime = (column: AnyPgColumn) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** 印の行より後ろ(asc なら大きい方・desc なら小さい方)。印が無ければ絞らない */
export function beyondCursor(
  cursor: Cursor | null,
  direction: "asc" | "desc",
  at: AnyPgColumn,
  id: AnyPgColumn,
): SQL | undefined {
  if (!cursor) return undefined;
  return direction === "asc"
    ? sql`(${at}, ${id}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
    : sql`(${at}, ${id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
}

/** limit + 1 件読んだ行から、返すページと続きの印を作る(1件多く読めたら続きがある) */
export function toPage<R>(
  rows: R[],
  limit: number,
  cursorOf: (row: R) => Cursor,
): { rows: R[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null,
  };
}
