// 個人情報の台帳(docs/db/personal-data.md)を、列の分類表(src/db/classification.ts)から作る。
//   pnpm docs:personal-data
// DB にはつながない。分類表と食い違うと test/unit/classification.test.ts が落ちる(手で書き換えない)。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  COLUMN_CLASSIFICATION,
  type DataClass,
  type FieldClass,
  SENSITIVE_SCHEMA,
} from "../src/db/classification.ts";

export const LEDGER_PATH = fileURLToPath(
  new URL("../../../docs/db/personal-data.md", import.meta.url),
);

const LABEL: Record<DataClass, string> = {
  public: "public",
  internal: "internal",
  personal: "**personal**",
  sensitive: "**sensitive**(要配慮)",
};

const isPersonal = (c: FieldClass) => c.class === "personal" || c.class === "sensitive";

function rowsByTable() {
  const tables = new Map<string, { column: string; c: FieldClass; key?: string }[]>();
  for (const [path, c] of Object.entries(COLUMN_CLASSIFICATION)) {
    const [schema, table, column] = path.split(".");
    const name = `${schema}.${table}`;
    const rows = tables.get(name) ?? [];
    rows.push({ column: column ?? path, c });
    for (const [key, k] of Object.entries(c.keys ?? {}))
      rows.push({ column: column ?? path, key, c: k });
    tables.set(name, rows);
  }
  return [...tables.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function renderLedger(): string {
  const tables = rowsByTable();
  const personal = tables.flatMap(([table, rows]) =>
    rows
      .filter((r) => isPersonal(r.c))
      .map(
        (r) =>
          `| \`${table}\` | \`${r.key ? `${r.column}.${r.key}` : r.column}\` | ${LABEL[r.c.class]} | ${r.c.purpose} |`,
      ),
  );
  const out = [
    "# 個人情報の台帳",
    "",
    "> **作ったファイル。手で直さない。** 元は `apps/api/src/db/classification.ts`(列の分類表)。`pnpm docs:personal-data` で作り直す。",
    "> 区分の意味と決まりは分類表の先頭・[docs/specs/0008-personal-data.md](../specs/0008-personal-data.md)・[ADR 0018](../adr/0018-sensitive-data-isolation.md)。",
    `> 要配慮個人情報(sensitive)は、スキーマ \`${SENSITIVE_SCHEMA}\` の表にだけ置ける。`,
    "",
    "## 個人情報を持つ列(personal / sensitive)",
    "",
    "プライバシーポリシーの「取得する情報と利用目的」・利用者からの開示や削除の依頼・漏えいのときの影響の範囲は、この表から答える。",
    "",
    "| 表 | 列 | 区分 | 利用目的 |",
    "|---|---|---|---|",
    ...personal,
    "",
    "## 全部の列",
    "",
  ];
  for (const [table, rows] of tables) {
    out.push(`### \`${table}\``, "", "| 列 | 区分 | 利用目的 |", "|---|---|---|");
    for (const r of rows) {
      const name = r.key ? `\`${r.column}\` の \`${r.key}\`` : `\`${r.column}\``;
      out.push(`| ${name} | ${LABEL[r.c.class]} | ${r.c.purpose} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(LEDGER_PATH, renderLedger());
  console.log(`personal-data.md: ${Object.keys(COLUMN_CLASSIFICATION).length} columns`);
}
