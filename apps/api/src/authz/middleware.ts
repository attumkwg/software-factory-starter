import type { Role } from "@app/shared";
import type { MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { auditEntryFor } from "../audit/capture.ts";
import { auditActionFor, recordAudit, supportReadAction } from "../audit/index.ts";
import { type SessionConfig, writeSession } from "../auth/session.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { findActiveSupportSession, findRole } from "../domains/organizations/index.ts";
import type { AppEnv } from "../env.ts";
import { ApiError, forbidden, unauthorized } from "../errors.ts";
import type { Logger } from "../logger.ts";
import { can, PUBLIC, ruleFor, toOpenApiPath } from "./policy.ts";

class Rollback extends Error {}
class SupportEnded extends Error {}

/**
 * /api/* の全リクエストの前に1回だけ通る「認可の関所」。
 *
 * 1. 呼ばれた API の決まり(policy.ts の ROUTE_RULES)を引く。**無ければ拒否**。
 * 2. 公開の API でなければ、セッションから決まったテナントでトランザクションを開く(RLS が効く)。
 * 3. そのテナントの中で利用者とロールを引き、権限が無ければ拒否。
 * 4. 通ったら c.var.tx / c.var.actor をハンドラーに渡す。失敗したらまとめて取り消す。
 * 5. 書き込みの API なら、成功したときに**同じトランザクションで**監査ログに1行(src/audit)。
 *    権限が無くて断ったときも「拒否」として残す(書き込みは取り消すので、別のトランザクションで)。
 * 6. 社員の代理ログイン(docs/specs/0004-support-access.md)なら、ロールは**閲覧者に固定**。
 *    いまも運営の組織の人か・入室が生きているか(終わっていない・期限内・許可が取り消されていない)を毎回 DB で確かめ、
 *    外れていたら Cookie を社員の本来の組織に戻して 401。**読んだことも**お客さんの監査ログに残す。
 */
export function authorize(deps: {
  db: RootDb;
  logger: Logger;
  session: SessionConfig;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method === "HEAD" ? "GET" : c.req.method;
    // Hono は登録順に最初のハンドラーで答えるので、最初に当たった /api/ のハンドラーを見る
    // (画面配信の「*」のような、/api/ の外のルートは API ではないので数えない)
    const handler = matchedRoutes(c).find((r) => r.method === method && r.path.startsWith("/api/"));
    // どの API にも当たらない → そのまま 404 に任せる
    if (!handler) return next();

    const path = toOpenApiPath(handler.path);
    const rule = ruleFor(method, path);
    if (rule === undefined) {
      deps.logger.error({ method, path }, "権限の決まりが無い API が呼ばれたので拒否しました");
      throw forbidden();
    }
    if (rule === PUBLIC) return next();

    const session = c.get("session");
    if (!session) throw unauthorized();

    const support = session.support;
    // 代理の社員は、読んだことも残す(自分が誰かを確かめる /api/me だけは数えない)
    const audit =
      auditActionFor(method, path) ??
      (support && method === "GET" && path !== "/api/me" ? supportReadAction(path) : undefined);
    const actor = { kind: support ? ("support" as const) : ("user" as const), id: session.userId };
    try {
      // 代理の社員が、いまも運営の組織の人か(辞めた・外された人は、入室の期限を待たずに止める)
      if (support) {
        const supportTenantId = c.get("supportTenantId");
        const staffRole =
          supportTenantId === support.homeTenantId
            ? await withTenant(deps.db, support.homeTenantId, (tx) =>
                findRole(tx, support.homeTenantId, session.userId),
              )
            : null;
        if (staffRole !== "admin" && staffRole !== "member") throw new SupportEnded();
      }
      await withTenant(deps.db, session.tenantId, async (tx) => {
        let role: Role | null;
        if (support) {
          const active = await findActiveSupportSession(
            tx,
            session.tenantId,
            support.sessionId,
            session.userId,
          );
          if (!active) throw new SupportEnded();
          role = "viewer";
        } else {
          role = await findRole(tx, session.tenantId, session.userId);
        }
        if (!role) throw unauthorized();
        if (!can(role, rule)) throw forbidden();

        c.set("actor", {
          userId: session.userId,
          tenantId: session.tenantId,
          role,
          ...(support ? { support: { sessionId: support.sessionId } } : {}),
        });
        c.set("tx", tx);
        await next();
        // ハンドラーが失敗していたら、書いた物を取り消す(監査ログにも残さない。起きていないので)
        if (c.error) throw new Rollback();
        if (audit && c.res.status < 400) {
          const entry = await auditEntryFor(c, {
            handlerPath: handler.path,
            audit,
            tenantId: session.tenantId,
            actor,
            outcome: "allowed",
            extraDetails: support ? { route: `${method} ${path}` } : undefined,
          });
          await recordAudit(tx, entry);
        }
      });
    } catch (e) {
      if (e instanceof Rollback) return;
      if (e instanceof SupportEnded && support) {
        // 代理が終わっている(期限・取り消し・自分で終えた)。社員の本来の組織に戻す
        await writeSession(c, deps.session, {
          userId: session.userId,
          tenantId: support.homeTenantId,
        });
        deps.logger.info(
          { supportSessionId: support.sessionId },
          "代理ログインが終わっていたので戻しました",
        );
        throw unauthorized();
      }
      if (audit && e instanceof ApiError && e.status === 403) {
        const entry = await auditEntryFor(c, {
          handlerPath: handler.path,
          audit,
          tenantId: session.tenantId,
          actor,
          outcome: "denied",
        });
        await withTenant(deps.db, session.tenantId, (tx) => recordAudit(tx, entry));
      }
      throw e;
    }
  };
}
