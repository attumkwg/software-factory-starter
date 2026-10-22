import { readFileSync } from "node:fs";
import { ALWAYS_REDACTED, isAllowedKey, isDeniedKey } from "@app/logging";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { LEDGER_PATH, renderLedger } from "../../scripts/personal-data-ledger.ts";
import { ROUTE_RULES } from "../../src/authz/policy.ts";
import {
  COLUMN_CLASSIFICATION,
  type ColumnClass,
  DATA_CLASSES,
  SENSITIVE_SCHEMA,
} from "../../src/db/classification.ts";
import * as schema from "../../src/db/schema.ts";
import { OUTBOX_TOPICS } from "../../src/outbox/topics.ts";

// 列の分類表(src/db/classification.ts)の網羅: DB の全部の列に区分と目的がある。
// AI が列を足しても、分類表に1行足さない限りここで落ちる(docs/specs/0008-personal-data.md の A)。

type Column = { path: string; schema: string; type: string };

const columns: Column[] = (Object.values(schema) as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .flatMap((t) => {
    const c = getTableConfig(t);
    const s = c.schema ?? "public";
    return c.columns.map((col) => ({
      path: `${s}.${c.name}.${col.name}`,
      schema: s,
      type: col.getSQLType(),
    }));
  });
const paths = columns.map((c) => c.path);

/** sensitive なのに、スキーマ sensitive の外にある列 */
function misplacedSensitive(classification: Record<string, ColumnClass>): string[] {
  return Object.entries(classification)
    .filter(([path, c]) => {
      const hasSensitiveKey = Object.values(c.keys ?? {}).some((k) => k.class === "sensitive");
      return (
        (c.class === "sensitive" || hasSensitiveKey) && !path.startsWith(`${SENSITIVE_SCHEMA}.`)
      );
    })
    .map(([path]) => path);
}

describe("列の分類表(src/db/classification.ts)の網羅", () => {
  it("全部の列に分類がある", () => {
    const missing = paths.filter((p) => !COLUMN_CLASSIFICATION[p]);
    expect(
      missing,
      "src/db/classification.ts に1行足してください(区分と利用目的。決め方は先頭の説明)",
    ).toEqual([]);
  });

  it("もう無い列の分類が残っていない", () => {
    const stale = Object.keys(COLUMN_CLASSIFICATION).filter((p) => !paths.includes(p));
    expect(stale).toEqual([]);
  });

  it("区分は4つのどれかで、目的が書いてある", () => {
    for (const [path, c] of Object.entries(COLUMN_CLASSIFICATION)) {
      for (const f of [c, ...Object.values(c.keys ?? {})]) {
        expect(DATA_CLASSES, path).toContain(f.class);
        expect(f.purpose.trim(), path).not.toBe("");
      }
    }
  });

  it("jsonb の列は中身のキーも分類する(jsonb でない列にはキーを書かない)", () => {
    for (const c of columns) {
      const keys = COLUMN_CLASSIFICATION[c.path]?.keys;
      if (c.type === "jsonb") expect(keys, `${c.path} に keys を書いてください`).toBeDefined();
      else expect(keys, c.path).toBeUndefined();
    }
  });
});

describe("要配慮個人情報(sensitive)は分けて置く(ADR 0018)", () => {
  it("sensitive の列は、スキーマ sensitive の表にしか無い", () => {
    expect(
      misplacedSensitive(COLUMN_CLASSIFICATION),
      "要配慮個人情報は、ほかのデータと混ぜない。先に ADR 0018 の段1(スキーマ sensitive・専用のロール・鍵)を作る",
    ).toEqual([]);
  });

  it("確かめ方の確かめ: ふつうのスキーマに sensitive を置くと見つかる", () => {
    const fake: Record<string, ColumnClass> = {
      "tasks.tasks.diagnosis": { class: "sensitive", purpose: "病名(例)" },
      "platform.outbox.payload": {
        class: "internal",
        purpose: "例",
        keys: { diagnosis: { class: "sensitive", purpose: "例" } },
      },
      [`${SENSITIVE_SCHEMA}.health.diagnosis`]: { class: "sensitive", purpose: "例" },
    };
    expect(misplacedSensitive(fake)).toEqual(["tasks.tasks.diagnosis", "platform.outbox.payload"]);
  });
});

describe("監査ログの details と送信待ちの payload の中身", () => {
  const details = COLUMN_CLASSIFICATION["platform.audit_events.details"]?.keys ?? {};
  const payload = COLUMN_CLASSIFICATION["platform.outbox.payload"]?.keys ?? {};

  it("出来事の中身のキー(src/outbox/topics.ts)が、全部分類されている", () => {
    const keys = new Set(Object.values(OUTBOX_TOPICS).flatMap((s) => Object.keys(s.shape)));
    const missing = [...keys].filter((k) => !payload[k]);
    expect(
      missing,
      "classification.ts の platform.outbox.payload の keys に足してください",
    ).toEqual([]);
  });

  it("API のパスの ID の名前(監査ログの details に入る)が、全部分類されている", () => {
    const params = new Set(
      Object.keys(ROUTE_RULES).flatMap((r) => [...r.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "")),
    );
    const missing = [...params].filter((p) => !details[p]);
    expect(
      missing,
      "classification.ts の platform.audit_events.details の keys に足してください",
    ).toEqual([]);
  });

  it("どちらにも personal / sensitive のキーは置けない(ID と名前だけ。ADR 0006・0013)", () => {
    const bad = Object.entries({ ...details, ...payload })
      .filter(([, k]) => k.class === "personal" || k.class === "sensitive")
      .map(([key]) => key);
    expect(bad).toEqual([]);
  });
});

describe("個人情報の台帳(docs/db/personal-data.md)", () => {
  it("分類表から作り直した物と同じ", () => {
    const current = readFileSync(LEDGER_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(current, "pnpm docs:personal-data で作り直してください").toBe(renderLedger());
  });
});

describe("ログの部品(@app/logging)と分類表", () => {
  // personal / sensitive の列とキーの名前(列は snake_case と camelCase の両方)
  const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  const personalNames = Object.entries(COLUMN_CLASSIFICATION).flatMap(([path, c]) => {
    const column = path.split(".")[2] ?? path;
    const own = c.class === "personal" || c.class === "sensitive" ? [column, camel(column)] : [];
    const keys = Object.entries(c.keys ?? {})
      .filter(([, k]) => k.class === "personal" || k.class === "sensitive")
      .map(([key]) => key);
    return [...own, ...keys];
  });

  it("個人情報の列の名前は、ログでどの深さにあっても伏せる名前に入っている", () => {
    const missing = [...new Set(personalNames)].filter((n) => !isDeniedKey(n));
    expect(
      missing,
      `packages/logging/src/fields.ts の ALWAYS_REDACTED に足してください(いま ${ALWAYS_REDACTED.length} 件)`,
    ).toEqual([]);
  });

  it("個人情報の列の名前は、許可リストに入っていない", () => {
    expect(personalNames.filter((n) => isAllowedKey(n))).toEqual([]);
  });
});
