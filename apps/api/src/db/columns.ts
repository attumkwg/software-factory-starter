import { timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

// どの領域の表でも同じにする列の作り方(scale.md「最初から決めておく」)。

/** 主キー。UUIDv7(時刻順に並ぶ)。連番を外に出さない。 */
export const id = (name: string) =>
  uuid(name)
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** 作った時刻。ある瞬間なので timestamptz(UTC で持つ)。 */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
