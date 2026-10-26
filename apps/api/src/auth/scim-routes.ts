import { IdSchema, SCIM_BASE_PATH } from "@app/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb, TenantTx } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import {
  createScimMember,
  findScimMember,
  findScimToken,
  listScimMembers,
  type ScimMember,
  touchScimToken,
  updateScimMember,
} from "../domains/organizations/index.ts";
import type { AppEnv } from "../env.ts";
import { forbidden, notFound, unauthorized } from "../errors.ts";
import { isFeatureEnabled } from "../feature-flags/index.ts";
import {
  changeFromPatch,
  changeFromPut,
  emailOf,
  nameOf,
  parseScimFilter,
  SCIM_LIST,
  SCIM_PAGE_MAX,
  type ScimChange,
  ScimListQuery,
  ScimPatchSchema,
  ScimProblem,
  type ScimUserInput,
  ScimUserInputSchema,
  scimErrorBody,
  toScimUser,
} from "./scim-protocol.ts";

// 情シスの道具の入口(SCIM 2.0 の Users。docs/specs/0056-sso-scim-ip-audit-export.md の段2・
// docs/designs/0056-sso-scim-ip-audit-export.md の 3・6)。
//   - セッションではなく SCIM の鍵(Authorization: Bearer)で組織が決まる。権限の決まりは公開(policy.ts)にして、
//     鍵の確かめ・組織の文脈(RLS)・監査ログ(行為者は kind: scim)は、ここの関所が自分でやる
//   - プランの機能 scim が入っていない組織の鍵は 403
//   - 扱えるのは、その組織の確かめたドメインのメールの人だけ(ほかの人は 404)。消す = 止める(行は残す。U-5)
//   - 組織の IP の範囲は当てない(道具は自分の会社の外の雲から呼ぶ。鍵とハッシュと取り消しで守る)
// 失敗の本文は SCIM の Error の形(src/app.ts の onError が scimErrorBody を使う)。

const MEDIA = "application/scim+json";
const tags = ["scim"];

class Rollback extends Error {}

/** SCIM の入口だけの関所: 鍵 → 組織 → 機能 → 組織の文脈のトランザクション。ハンドラーが失敗したら書いた物を取り消す */
function scimGate(db: RootDb): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const found = token ? await findScimToken(db, token) : null;
    if (!found) throw unauthorized();
    const defs = { featureFlags: c.get("featureFlags"), plans: c.get("plans") };
    try {
      await withTenant(db, found.tenantId, async (tx) => {
        const on = await isFeatureEnabled(
          tx,
          found.tenantId,
          defs.featureFlags,
          "scim",
          defs.plans,
        );
        if (!on) throw forbidden();
        await touchScimToken(tx, found.tenantId, found.tokenId);
        c.set("tx", tx);
        c.set("scim", found);
        await next();
        if (c.error) throw new Rollback();
      });
    } catch (e) {
      if (e instanceof Rollback) return;
      throw e;
    }
  };
}

function scimOf(c: Context<AppEnv>): { tx: TenantTx; tenantId: string; tokenId: string } {
  const scim = c.get("scim");
  if (!scim) throw unauthorized();
  return { tx: c.get("tx"), ...scim };
}

/** SCIM の本文で答える(Content-Type は application/scim+json) */
function scimJson<T extends Response>(res: T): T {
  res.headers.set("content-type", MEDIA);
  return res;
}

/** 起きたことを監査ログに(行為者は鍵。名前・メールは入れず、直した項目の名前だけ) */
async function auditChanges(
  c: Context<AppEnv>,
  before: ScimMember | null,
  after: ScimMember,
  change: ScimChange,
) {
  const { tx, tenantId, tokenId } = scimOf(c);
  const entry = (action: string, details: Record<string, unknown> = {}) =>
    recordAudit(tx, {
      tenantId,
      actor: { kind: "scim", id: tokenId },
      action,
      target: { type: "user", id: after.id },
      outcome: "allowed",
      details,
    });
  if (!before) {
    await entry(MANUAL_AUDIT_ACTIONS.scimUserCreate);
    if (!after.active) await entry(MANUAL_AUDIT_ACTIONS.scimUserDisable);
    return;
  }
  const fields = [
    ...(change.name !== undefined && change.name !== before.name ? ["name"] : []),
    ...(change.externalId !== undefined && change.externalId !== before.externalId
      ? ["externalId"]
      : []),
  ];
  if (fields.length > 0) await entry(MANUAL_AUDIT_ACTIONS.scimUserUpdate, { fields });
  if (before.active && !after.active) await entry(MANUAL_AUDIT_ACTIONS.scimUserDisable);
  if (!before.active && after.active) await entry(MANUAL_AUDIT_ACTIONS.scimUserEnable);
}

const UserParams = z.object({ scimUserId: IdSchema });
const scimBody = <T extends z.ZodType>(schema: T) => ({
  content: { [MEDIA]: { schema }, "application/json": { schema } },
  required: true,
});
const scimResponse = (description: string) => ({
  content: { [MEDIA]: { schema: z.record(z.string(), z.unknown()) } },
  description,
});
const scimErrors = {
  400: scimResponse("入力が正しくない(scimType つき)"),
  401: scimResponse("鍵が無い・違う・取り消した"),
  403: scimResponse("プランに SCIM が無い"),
};

/** 1人を引き、なければ 404(他社の人・確かめたドメインの外の人も) */
async function memberOr404(c: Context<AppEnv>, userId: string): Promise<ScimMember> {
  const { tx, tenantId } = scimOf(c);
  const m = await findScimMember(tx, tenantId, userId);
  if (!m) throw notFound();
  return m;
}

async function applyChange(c: Context<AppEnv>, before: ScimMember, change: ScimChange) {
  const { tx, tenantId } = scimOf(c);
  const after = await updateScimMember(tx, tenantId, before.id, change);
  if (!after) throw notFound();
  await auditChanges(c, before, after, change);
  return after;
}

const listRoute = createRoute({
  method: "get",
  path: "/scim/v2/Users",
  tags,
  summary: "【SCIM】その組織の人の一覧(userName eq・externalId eq で絞れる。startIndex は 1 から)",
  request: { query: ScimListQuery },
  responses: { 200: scimResponse("ListResponse"), ...scimErrors },
});

const createUserRoute = createRoute({
  method: "post",
  path: "/scim/v2/Users",
  tags,
  summary:
    "【SCIM】人を作る(メールは確かめたドメインだけ・ロールは member。もういれば 409 uniqueness)",
  request: { body: scimBody(ScimUserInputSchema) },
  responses: {
    201: scimResponse("作った"),
    409: scimResponse("同じメールの人がもういる"),
    ...scimErrors,
  },
});

const getUserRoute = createRoute({
  method: "get",
  path: "/scim/v2/Users/{scimUserId}",
  tags,
  summary: "【SCIM】1人",
  request: { params: UserParams },
  responses: { 200: scimResponse("その人"), 404: scimResponse("いない"), ...scimErrors },
});

const putUserRoute = createRoute({
  method: "put",
  path: "/scim/v2/Users/{scimUserId}",
  tags,
  summary: "【SCIM】置き換える(名前・externalId・active。メールは変えられない)",
  request: { params: UserParams, body: scimBody(ScimUserInputSchema) },
  responses: { 200: scimResponse("直した"), 404: scimResponse("いない"), ...scimErrors },
});

const patchUserRoute = createRoute({
  method: "patch",
  path: "/scim/v2/Users/{scimUserId}",
  tags,
  summary: "【SCIM】一部を直す(active: false で止める。止めた人は次のリクエストから入れない)",
  request: { params: UserParams, body: scimBody(ScimPatchSchema) },
  responses: { 200: scimResponse("直した"), 404: scimResponse("いない"), ...scimErrors },
});

const deleteUserRoute = createRoute({
  method: "delete",
  path: "/scim/v2/Users/{scimUserId}",
  tags,
  summary: "【SCIM】消す(= 止める。行・名前・メール・監査ログは残す)",
  request: { params: UserParams },
  responses: { 204: { description: "止めた" }, 404: scimResponse("いない"), ...scimErrors },
});

async function listUsers(c: Context<AppEnv>, q: z.infer<typeof ScimListQuery>) {
  const { tx, tenantId } = scimOf(c);
  const page = await listScimMembers(tx, tenantId, {
    filter: parseScimFilter(q.filter),
    startIndex: q.startIndex,
    count: Math.min(q.count, SCIM_PAGE_MAX),
  });
  return {
    schemas: [SCIM_LIST],
    totalResults: page.total,
    startIndex: q.startIndex,
    itemsPerPage: page.members.length,
    Resources: page.members.map((m) => toScimUser(m, SCIM_BASE_PATH)),
  };
}

/** 作る(確かめたドメインの外は 400 invalidValue・同じメールの人がいれば 409 uniqueness。scimErrorBody の既定) */
async function createUser(c: Context<AppEnv>, input: ScimUserInput) {
  const { tx, tenantId } = scimOf(c);
  const email = emailOf(input);
  const created = await createScimMember(tx, tenantId, {
    email,
    name: nameOf(input) ?? email.split("@")[0] ?? email,
    externalId: input.externalId ?? null,
  });
  const after =
    input.active === false
      ? ((await updateScimMember(tx, tenantId, created.id, { active: false })) ?? created)
      : created;
  await auditChanges(c, null, after, {});
  return toScimUser(after, SCIM_BASE_PATH);
}

export function scimRoutes(deps: { db: RootDb }) {
  const router = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        const detail = result.error.issues
          .map((i) => `${i.path.join(".") || "(本文)"}: ${i.message}`)
          .join("; ");
        throw new ScimProblem(400, "invalidValue", detail);
      }
    },
  });
  router.use("/scim/v2/*", scimGate(deps.db));
  router
    .openapi(listRoute, async (c) =>
      scimJson(c.json(await listUsers(c, c.req.valid("query")), 200)),
    )
    .openapi(createUserRoute, async (c) =>
      scimJson(c.json(await createUser(c, c.req.valid("json")), 201)),
    )
    .openapi(getUserRoute, async (c) => {
      const m = await memberOr404(c, c.req.valid("param").scimUserId);
      return scimJson(c.json(toScimUser(m, SCIM_BASE_PATH), 200));
    })
    .openapi(putUserRoute, async (c) => {
      const before = await memberOr404(c, c.req.valid("param").scimUserId);
      const after = await applyChange(c, before, changeFromPut(before, c.req.valid("json")));
      return scimJson(c.json(toScimUser(after, SCIM_BASE_PATH), 200));
    })
    .openapi(patchUserRoute, async (c) => {
      const before = await memberOr404(c, c.req.valid("param").scimUserId);
      const after = await applyChange(c, before, changeFromPatch(before, c.req.valid("json")));
      return scimJson(c.json(toScimUser(after, SCIM_BASE_PATH), 200));
    })
    .openapi(deleteUserRoute, async (c) => {
      const before = await memberOr404(c, c.req.valid("param").scimUserId);
      await applyChange(c, before, { active: false });
      return c.body(null, 204);
    });
  return router;
}

export { scimErrorBody };
