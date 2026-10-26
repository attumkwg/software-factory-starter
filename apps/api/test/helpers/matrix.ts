import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

export const ACTORS = ["admin", "member", "viewer", "other_tenant", "anonymous"] as const;
export type MatrixActor = (typeof ACTORS)[number];

const RowSchema = z
  .object({
    route: z.string().regex(/^(GET|POST|PUT|PATCH|DELETE) \/\S+$/),
    permission: z.string(),
    note: z.string().optional(),
    only_in: z.enum(["dev", "cognito"]).optional(),
    // セッションではなく SCIM の鍵で組織が決まる入口(鍵を持たずに叩くので、だれでも 401・他社の行は要らない)
    auth: z.enum(["scim"]).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    expect: z.object({
      admin: z.number().int(),
      member: z.number().int(),
      viewer: z.number().int(),
      anonymous: z.number().int(),
      other_tenant: z.number().int().optional(),
    }),
  })
  .strict()
  .superRefine((row, ctx) => {
    // パスに ID がある API は、他社から叩いたときの答え(404)を必ず書く
    if (row.route.includes("{") && row.expect.other_tenant === undefined && row.auth !== "scim") {
      ctx.addIssue({ code: "custom", message: `${row.route}: other_tenant の行がありません` });
    }
    if (row.expect.other_tenant !== undefined && row.expect.other_tenant !== 404) {
      ctx.addIssue({ code: "custom", message: `${row.route}: 他社の物は 404 にします` });
    }
  });

export type MatrixRow = z.infer<typeof RowSchema>;

export function loadMatrix(): MatrixRow[] {
  const file = new URL("../../../../docs/authz/matrix.yaml", import.meta.url);
  const doc = z.object({ routes: z.array(RowSchema) }).parse(parse(readFileSync(file, "utf8")));
  return doc.routes;
}
