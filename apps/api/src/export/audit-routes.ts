import { AuditEventSchema, AuditExportRequestSchema, localDayRange } from "@app/shared";
import { createRoute, type RouteConfigToTypedResponse } from "@hono/zod-openapi";
import { auditEventsInRangePage } from "../audit/index.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { findTimeZone } from "../domains/organizations/index.ts";
import { requireFeature } from "../feature-flags/index.ts";
import { authErrors, bodyErrors, createRouter, jsonBody, notFoundError } from "../http/common.ts";
import type { Logger } from "../logger.ts";
import { EXPORT_PAGE_SIZE, exportStream, type InTenant } from "./stream.ts";

// 監査ログの書き出し(管理者・プランの機能 audit-export。docs/specs/0056-sso-scim-ip-audit-export.md の段3・
// docs/designs/0056-sso-scim-ip-audit-export.md の 3・6)。お客さんの情シスが自分たちの道具(SIEM など)に取り込む。
//   - 期間は日付(両端を含む・組織の時間帯の1日)で、最長 366 日。1行1件の JSON(JSON Lines)で古い順に流す
//   - 1行の形は画面の監査ログと同じ(AuditEventSchema。値は入っていない)
//   - 流し方はデータの書き出しと同じ(ADR 0031): ページごとに短いテナントのトランザクション・受け手が読みに来たときだけ次へ
//   - 書き出したことは、認可の関所が監査ログに残す(src/audit/actions.ts の audit.export。流し始めた時点で)
// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。

const route = createRoute({
  method: "post",
  path: "/audit-events/export",
  tags: ["audit"],
  summary:
    "【管理者】監査ログを期間(日付・最長 366 日)を選んで JSON Lines で書き出す(古い順。書き出したことも監査ログに残る)",
  request: { body: jsonBody(AuditExportRequestSchema) },
  responses: {
    200: {
      content: { "application/x-ndjson": { schema: AuditEventSchema } },
      description: "1行1件の監査ログ(添付のファイルとして返す)",
    },
    ...bodyErrors,
    ...authErrors,
    ...notFoundError,
  },
});

/** 1ページずつ読んで、1行1件の JSON にする */
export async function* auditExportLines(
  inTenant: InTenant,
  range: { start: Date; end: Date },
  pageSize = EXPORT_PAGE_SIZE,
): AsyncGenerator<string> {
  let after: string | null = null;
  do {
    const page = await inTenant((s) => auditEventsInRangePage(s, range, after, pageSize));
    if (page.rows.length > 0) yield `${page.rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    after = page.nextCursor;
  } while (after !== null);
}

export function auditExportRoutes(deps: { db: RootDb; logger: Logger }) {
  return createRouter().openapi(route, async (c) => {
    await requireFeature(c, "audit-export");
    const { tenantId, userId } = c.get("actor");
    const { from, to } = c.req.valid("json");
    const timeZone = (await findTimeZone(c.get("tx"), tenantId)) ?? "Asia/Tokyo";
    const range = {
      start: localDayRange(from, timeZone).start,
      end: localDayRange(to, timeZone).end,
    };
    const lines = auditExportLines(
      (fn) => withTenant(deps.db, tenantId, (tx) => fn({ tx, tenantId, userId })),
      range,
    );
    const res = c.body(exportStream(lines, deps.logger), 200, {
      "content-type": "application/x-ndjson; charset=UTF-8",
      "content-disposition": `attachment; filename="audit-events-${from}-${to}.jsonl"`,
      "cache-control": "no-store",
    });
    // 本文は少しずつ流す JSON Lines。1行の形は AuditEventSchema
    return res as unknown as RouteConfigToTypedResponse<typeof route>;
  });
}
