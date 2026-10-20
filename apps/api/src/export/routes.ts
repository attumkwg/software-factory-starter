import { EXPORT_FORMAT, type ExportData, ExportSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { exportAuditEvents } from "../audit/index.ts";
import { scopeOf } from "../db/scope.ts";
import {
  exportEmailChanges,
  exportOrganization,
  exportSupportGrants,
} from "../domains/organizations/index.ts";
import { exportProjects } from "../domains/projects/index.ts";
import { exportTasks } from "../domains/tasks/index.ts";
import { authErrors, createRouter, json } from "../http/common.ts";

// データの書き出し(管理者。docs/specs/0005-offboarding.md)。共通の仕組みなので領域の外に置く。
// 各領域が自分の行を出し(index.ts の export…)、ここで1つにまとめる。テナントの文脈の中なので他社は入らない。
// 書き出したことは、認可の関所が監査ログに残す(src/audit/actions.ts の data.export)。
// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。

export const exportRoutes = createRouter().openapi(
  createRoute({
    method: "post",
    path: "/exports",
    tags: ["export"],
    summary: "自社のデータを1つの JSON で書き出す(管理者だけ。書き出したことは監査ログに残る)",
    responses: { 200: json(ExportSchema, "書き出した(添付のファイルとして返す)"), ...authErrors },
  }),
  async (c) => {
    const s = scopeOf(c);
    const { organization, users } = await exportOrganization(s);
    const data: ExportData = {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      organization,
      users,
      projects: await exportProjects(s),
      tasks: await exportTasks(s),
      auditEvents: await exportAuditEvents(s),
      supportGrants: await exportSupportGrants(s),
      emailChanges: await exportEmailChanges(s),
    };
    const date = data.exportedAt.slice(0, 10);
    c.header("content-disposition", `attachment; filename="export-${date}.json"`);
    c.header("cache-control", "no-store");
    return c.json(data, 200);
  },
);
