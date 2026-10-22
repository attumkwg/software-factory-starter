import { bigint, char, date, numeric, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

// どの領域の表でも同じにする列の作り方(docs/concepts/stages.md「最初の日に決めておく8つ」)。

/** 主キー。UUIDv7(時刻順に並ぶ)。連番を外に出さない。 */
export const id = (name: string) =>
  uuid(name)
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** 作った時刻。ある瞬間なので timestamptz(UTC で持つ)。 */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ── お金と時刻(ADR 0005)。計算は @app/shared の money.ts / time.ts で ──

/** 金額: 最小単位の整数(円・セント)。number で受け取る(9千兆を超えると崩れるので、MoneySchema で確かめる)。 */
export const moneyAmount = (name: string) => bigint(name, { mode: "number" });
/** 通貨(ISO 4217 の3文字)。金額の列と必ず組で持つ。 */
export const currencyCode = (name: string) => char(name, { length: 3 });
/** 単価・率(整数にならないもの)。文字列で受け取る(小数に直さない)。 */
export const decimal = (name: string, precision = 20, scale = 6) =>
  numeric(name, { precision, scale, mode: "string" });
/** ある瞬間(UTC)。 */
export const instant = (name: string) => timestamp(name, { withTimezone: true });
/** 日付だけ(期限・誕生日)。時間帯を持たない。"2026-10-18" の文字列で受け取る。 */
export const dateOnly = (name: string) => date(name, { mode: "string" });
