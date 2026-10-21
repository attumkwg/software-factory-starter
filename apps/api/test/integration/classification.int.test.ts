import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { COLUMN_CLASSIFICATION } from "../../src/db/classification.ts";

// 本物の DB(全部の移行を流した後)の列と、列の分類表を突き合わせる。
// 単体の classification.test.ts は drizzle の定義しか見ない。移行の SQL だけで足した表・列もここで捕まえる。

const owner = new pg.Pool({ connectionString: inject("ownerUrl"), max: 1 });
afterAll(() => owner.end());

describe("DB の列と分類表", () => {
  it("DB にある列は、全部分類されている(移行の SQL だけで足した物も)", async () => {
    const { rows } = await owner.query<{ path: string }>(
      `select c.table_schema || '.' || c.table_name || '.' || c.column_name as path
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where t.table_type = 'BASE TABLE'
          and c.table_schema not in ('pg_catalog', 'information_schema', 'drizzle')`,
    );
    const missing = rows.map((r) => r.path).filter((p) => !COLUMN_CLASSIFICATION[p]);
    expect(missing, "src/db/classification.ts に1行足してください").toEqual([]);
  });
});
