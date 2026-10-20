import type {
  Account,
  ApiError,
  AuditEventPage,
  AuthNext,
  AuthOptions,
  CreatedSupportGrant,
  CreateProject,
  CreateSupportGrant,
  CreateTask,
  ExportData,
  Me,
  MfaRequirement,
  MfaSetup,
  Project,
  ProjectPage,
  StartSupport,
  SupportGrant,
  SupportSession,
  Task,
  TaskPage,
  UpdateTask,
} from "@app/shared";
import { PAGE_LIMIT } from "@app/shared";
import { createIsomorphicFn } from "@tanstack/react-start";
import { appendResponseHeader, getRequest } from "@tanstack/react-start/server";
import { sessionSetCookies, withCode } from "./api-parts.ts";

// API の呼び出し。型は packages/shared の契約をそのまま使う。
// 認証は HttpOnly の Cookie(同じオリジン)。トークンを localStorage に置かない。
//
// 同じ関数が2か所で動く(TanStack Start の loader は SSR とブラウザの両方で動く):
//   ブラウザ … /api へ(ALB が API のサービスへ振り分ける)。Cookie はブラウザが付ける
//   SSR     … API_INTERNAL_URL へ直接(ECS の Service Connect)。来た Cookie と request ID を渡す
// SSR から API を呼ぶのは読み取り(GET)だけ。書き込みは必ずブラウザから(CSRF の守りを通す)。

/** API が失敗を返した(4xx / 5xx)。code で分岐する(packages/shared の ERROR_CODES)。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.error.message ?? `HTTP ${status}`);
  }
  get code() {
    return this.body?.error.code;
  }
  get requestId() {
    return this.body?.error.requestId;
  }
}

/**
 * API まで届かなかった(通信が切れている・時間切れ)。
 * side … どこで起きたか。browser なら利用者の通信の問題かもしれない。server(SSR)ならこちらの問題。
 */
export class NetworkError extends Error {
  constructor(
    readonly reason: "timeout" | "unreachable",
    readonly side: "server" | "browser",
    options?: { cause?: unknown },
  ) {
    super(
      reason === "timeout" ? "API の応答が時間内にありませんでした" : "API に届きませんでした",
      options,
    );
  }
}

type Failure = { method: string; path: string; status?: number; reason?: string };
type Target = {
  side: "server" | "browser";
  base: string;
  headers: Record<string, string>;
  timeoutMs: number;
  /** 失敗を記録する(SSR だけ。ブラウザの失敗は画面に出す) */
  report: (failure: Failure) => void;
  /** API の応答から、ブラウザへ渡す物を写す(SSR だけ。ブラウザは自分で受け取る) */
  relay: (res: Response) => void;
};

// SSR のときに API へ引き継ぐヘッダー。これ以外(Host・Authorization など)は渡さない。
const FORWARDED_HEADERS = ["cookie", "x-request-id", "traceparent", "x-amzn-trace-id"];

const target = createIsomorphicFn()
  .server((method: string): Target => {
    if (method !== "GET") throw new Error("SSR から API に書き込まない(ブラウザから呼ぶ)");
    const incoming = getRequest().headers;
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_HEADERS) {
      const value = incoming.get(name);
      if (value) headers[name] = value;
    }
    return {
      side: "server",
      base: process.env.API_INTERNAL_URL ?? "http://localhost:3000",
      headers,
      // ALB の待ち時間(60秒)より十分短く。API が詰まっても画面のサーバーまで詰まらない
      timeoutMs: 10_000,
      // 画面のサーバーの JSON ログと同じ形(server/index.ts)。Logs Insights で requestId から API の行と突き合わせる
      // Sentry には送らない(API の 5xx は API が送る・API に届かないならアラームが鳴る。二重に数えない)
      report: (failure) =>
        process.stdout.write(
          `${JSON.stringify({
            level: failure.status !== undefined && failure.status < 500 ? "warn" : "error",
            time: new Date().toISOString(),
            service: "web",
            requestId: headers["x-request-id"] ?? null,
            ...failure,
            message: "SSR から API を読めませんでした",
          })}\n`,
        ),
      // API が出し直したセッションの Cookie を画面の応答に写す(画面を開き直すだけでも期限が延びる。ADR 0017)
      relay: (res) => {
        for (const cookie of sessionSetCookies(res)) appendResponseHeader("set-cookie", cookie);
      },
    };
  })
  .client(
    (_method: string): Target => ({
      side: "browser",
      base: "",
      headers: {},
      timeoutMs: 15_000,
      report: () => {},
      relay: () => {},
    }),
  );

const isApiError = (v: unknown): v is ApiError =>
  typeof v === "object" && v !== null && typeof (v as ApiError).error?.code === "string";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { side, base, headers, timeoutMs, report, relay } = target(method);
  let res: Response;
  try {
    res = await fetch(`${base}/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const reason =
      cause instanceof DOMException && cause.name === "TimeoutError" ? "timeout" : "unreachable";
    report({ method, path, reason });
    throw new NetworkError(reason, side, { cause });
  }
  relay(res);
  if (!res.ok) {
    // ALB が返す 502 / 504 は HTML なので、決まった形でなければ本文は無い扱い
    const parsed = await res.json().catch(() => null);
    // 401 はログインし直せばよいので、記録しない
    if (res.status !== 401) report({ method, path, status: res.status });
    throw new HttpError(res.status, isApiError(parsed) ? parsed : null);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// 一覧は API がページで返す(1回に最大 PAGE_LIMIT.max 件。docs/guides/api-changes.md)。
// 画面にページ送りが付くまでは、続きを LIST_MAX_PAGES 回まで読んで、いまと同じく全部を見せる
// (それより多い分は出ない。1000件を超える組織・プロジェクトが出る前に、画面にページ送りを付ける)。
const LIST_MAX_PAGES = 10;

async function readPages<P extends { nextCursor: string | null }, T>(
  path: string,
  items: (page: P) => T[],
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < LIST_MAX_PAGES; i++) {
    const next: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page: P = await request<P>("GET", `${path}?limit=${PAGE_LIMIT.max}${next}`);
    all.push(...items(page));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return all;
}

export const api = {
  authOptions: () => request<AuthOptions>("GET", "/auth/options"),
  devLogin: (email: string) => request<{ ok: true }>("POST", "/auth/dev-login", { email }),
  // Cognito のとき(画面 → API → Cognito。トークンは API の中だけ)
  login: (email: string, password: string) =>
    request<AuthNext>("POST", "/auth/login", { email, password }),
  answerMfa: (code: string) => request<AuthNext>("POST", "/auth/mfa", { code }),
  signUp: (email: string, password: string) =>
    request<AuthNext>("POST", "/auth/sign-up", { email, password }),
  confirmSignUp: (email: string, code: string) =>
    request<AuthNext>("POST", "/auth/confirm-sign-up", { email, code }),
  resendCode: (email: string) => request<AuthNext>("POST", "/auth/resend-code", { email }),
  forgotPassword: (email: string) => request<AuthNext>("POST", "/auth/forgot-password", { email }),
  resetPassword: (email: string, code: string, password: string) =>
    request<AuthNext>("POST", "/auth/reset-password", { email, code, password }),
  logout: () => request<void>("POST", "/auth/logout"),
  me: () => request<Me>("GET", "/me"),
  listProjects: async (): Promise<{ projects: Project[] }> => ({
    projects: await readPages<ProjectPage, Project>("/projects", (p) => p.projects),
  }),
  getProject: (id: string) => request<Project>("GET", `/projects/${id}`),
  createProject: (input: CreateProject) => request<Project>("POST", "/projects", input),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),
  // サポートの代理ログイン(docs/specs/0004-support-access.md)
  listSupportGrants: () => request<{ grants: SupportGrant[] }>("GET", "/support-grants"),
  createSupportGrant: (input: CreateSupportGrant) =>
    request<CreatedSupportGrant>("POST", "/support-grants", input),
  revokeSupportGrant: (id: string) => request<void>("DELETE", `/support-grants/${id}`),
  startSupport: (input: StartSupport) =>
    request<SupportSession>("POST", "/support/sessions", input),
  endSupport: () => request<void>("POST", "/support/end"),
  // 本人のアカウント(docs/specs/0006-account-security.md)。Cognito のときだけある
  getAccount: () => request<Account>("GET", "/account"),
  reauth: (password: string, code?: string) =>
    request<{ ok: true }>("POST", "/account/reauth", withCode({ password }, code)),
  changePassword: (currentPassword: string, newPassword: string, code?: string) =>
    request<void>("POST", "/account/password", withCode({ currentPassword, newPassword }, code)),
  requestEmailChange: (newEmail: string) =>
    request<{ next: "confirm" }>("POST", "/account/email", { newEmail }),
  confirmEmailChange: (code: string) => request<void>("POST", "/account/email/confirm", { code }),
  setupMfa: () => request<MfaSetup>("POST", "/account/mfa/setup"),
  enableMfa: (code: string) => request<void>("POST", "/account/mfa/enable", { code }),
  disableMfa: (password: string, code: string) =>
    request<void>("POST", "/account/mfa/disable", { password, code }),
  // 組織の二段階認証の必須(管理者だけ)
  getMfaRequirement: () => request<MfaRequirement>("GET", "/organization/mfa-requirement"),
  requireMfa: () => request<void>("POST", "/organization/mfa-requirement"),
  unrequireMfa: () => request<void>("DELETE", "/organization/mfa-requirement"),
  // データの書き出し(docs/specs/0005-offboarding.md)。管理者だけ
  exportData: () => request<ExportData>("POST", "/exports"),
  listAuditEvents: (before?: string) =>
    request<AuditEventPage>(
      "GET",
      before ? `/audit-events?before=${encodeURIComponent(before)}` : "/audit-events",
    ),
  listTasks: async (projectId: string): Promise<{ tasks: Task[] }> => ({
    tasks: await readPages<TaskPage, Task>(`/projects/${projectId}/tasks`, (p) => p.tasks),
  }),
  createTask: (projectId: string, input: CreateTask) =>
    request<Task>("POST", `/projects/${projectId}/tasks`, input),
  updateTask: (id: string, input: UpdateTask) => request<Task>("PATCH", `/tasks/${id}`, input),
  deleteTask: (id: string) => request<void>("DELETE", `/tasks/${id}`),
};
