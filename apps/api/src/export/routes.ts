import { ExportSchema } from "@app/shared";
import { createRoute, type RouteConfigToTypedResponse } from "@hono/zod-openapi";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { authErrors, createRouter, json } from "../http/common.ts";
import type { Logger } from "../logger.ts";
import { exportChunks, exportStream } from "./stream.ts";

// データの書き出し(管理者。docs/specs/0005-offboarding.md・0018-export-stream.md)。共通の仕組みなので領域の外に置く。
// 各領域が自分の行を1ページずつ出し(index.ts の export…Page)、stream.ts が1つの JSON にして流す。
// 書き出したことは、認可の関所が監査ログに残す(src/audit/actions.ts の data.export。流し始めた時点で)。
// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。
//
// 本文は、関所のトランザクションが閉じた後に流れる(ADR 0031)。そのためページごとに、ここで短い
// テナントのトランザクションを開く。テナントはセッション(関所が決めた actor)からだけで、リクエストの値は見ない。
// 同じ形は src/auth/account-routes.ts の inTenant(外を待つ API)。

const route = createRoute({
  method: "post",
  path: "/exports",
  tags: ["export"],
  summary:
    "自社のデータを1つの JSON で書き出す(管理者だけ。少しずつ流して返す。書き出したことは監査ログに残る)",
  responses: { 200: json(ExportSchema, "書き出した(添付のファイルとして返す)"), ...authErrors },
});

export function exportRoutes(deps: { db: RootDb; logger: Logger }) {
  return createRouter().openapi(route, (c) => {
    const { tenantId, userId } = c.get("actor");
    const exportedAt = new Date().toISOString();
    const chunks = exportChunks(
      (fn) => withTenant(deps.db, tenantId, (tx) => fn({ tx, tenantId, userId })),
      exportedAt,
    );
    const date = exportedAt.slice(0, 10);
    const res = c.body(exportStream(chunks, deps.logger), 200, {
      "content-type": "application/json; charset=UTF-8",
      "content-disposition": `attachment; filename="export-${date}.json"`,
      "cache-control": "no-store",
    });
    // 本文は少しずつ流す JSON。中身の形は OpenAPI の ExportSchema のままなので、型は JSON の応答にそろえる
    return res as unknown as RouteConfigToTypedResponse<typeof route>;
  });
}
