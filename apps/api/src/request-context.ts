import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";

/** 1リクエストの間ずっと持ち回る文脈。ログの全行にここの値が入る。 */
export type RequestContext = {
  requestId: string;
  traceId: string;
  /** ログインのセッションから決まったテナント。ログイン前は null。 */
  tenantId: string | null;
  /** ログインしている人(users の ID。メールアドレスではない)。ログイン前は null。 */
  userId: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** リクエストの文脈の外で動かす(DB の接続の出来事などに、たまたま前のリクエストの ID が付かないように)。 */
export function runOutsideRequestContext<T>(fn: () => T): T {
  return storage.exit(fn);
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;
const AMZN_TRACE_ROOT = /Root=1-([\da-f]{8})-([\da-f]{24})/;

/** 上流(ALB・別サービス)から来た ID を引き継ぐ。形が変なら捨てて作り直す。 */
export function contextFromHeaders(get: (name: string) => string | undefined): RequestContext {
  const incomingRequestId = get("x-request-id");
  const requestId =
    incomingRequestId && REQUEST_ID.test(incomingRequestId) ? incomingRequestId : randomUUID();

  const traceparent = get("traceparent")?.match(TRACEPARENT);
  const amzn = get("x-amzn-trace-id")?.match(AMZN_TRACE_ROOT);
  const traceId =
    traceparent?.[1] ?? (amzn ? `${amzn[1]}${amzn[2]}` : randomBytes(16).toString("hex"));

  return { requestId, traceId, tenantId: null, userId: null };
}
