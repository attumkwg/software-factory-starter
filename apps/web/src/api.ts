import type {
  AcceptedInvitation,
  Account,
  ApiError,
  AuditEventPage,
  AuditExportRequest,
  AuthNext,
  AuthOptions,
  CreatedScimToken,
  CreatedSupportGrant,
  CreateInvitation,
  CreateProject,
  CreateSupportGrant,
  CreateTask,
  Invitation,
  InvitationPage,
  IpAllowlist,
  LegalVersionRef,
  Me,
  MfaRequirement,
  MfaSetup,
  OrganizationDomain,
  OrganizationDomainList,
  OrganizationMember,
  OrganizationMemberPage,
  OrganizationMembershipList,
  OrganizationPlan,
  PmfSurveyAnswer,
  PmfSurveyStatus,
  Project,
  ProjectPage,
  PutSsoSettings,
  Role,
  ScimTokenList,
  SsoSettings,
  SsoStartResult,
  StartSupport,
  SupportGrant,
  SupportSession,
  Task,
  TaskMail,
  TaskPage,
  UpdateTask,
} from "@app/shared";
import { PAGE_LIMIT } from "@app/shared";
import { createIsomorphicFn } from "@tanstack/react-start";
import { appendResponseHeader, getRequest } from "@tanstack/react-start/server";
import { HttpError, NetworkError } from "./api-errors.ts";
import { sessionSetCookies, withCode } from "./api-parts.ts";

export { HttpError, NetworkError };

// API の呼び出し。型は packages/shared の契約をそのまま使う。
// 認証は HttpOnly の Cookie(同じオリジン)。トークンを localStorage に置かない。
//
// 同じ関数が2か所で動く(TanStack Start の loader は SSR とブラウザの両方で動く):
//   ブラウザ … /api へ(ALB が API のサービスへ振り分ける)。Cookie はブラウザが付ける
//   SSR     … API_INTERNAL_URL へ直接(ECS の Service Connect)。来た Cookie と request ID を渡す
// SSR から API を呼ぶのは読み取り(GET)だけ。書き込みは必ずブラウザから(CSRF の守りを通す)。

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
// いまの人の IP のヘッダー(組織ごとの IP の制限。docs/specs/0056-sso-scim-ip-audit-export.md)も引き継ぐ。
// 名前は API と同じ環境変数 CLIENT_IP_HEADER(既定は ALB が付ける x-forwarded-for。CloudFront なら cloudfront-viewer-address)
const FORWARDED_HEADERS = ["cookie", "x-request-id", "traceparent", "x-amzn-trace-id"];
const clientIpHeader = () => (process.env.CLIENT_IP_HEADER ?? "x-forwarded-for").toLowerCase();

const target = createIsomorphicFn()
  .server((method: string): Target => {
    if (method !== "GET") throw new Error("SSR から API に書き込まない(ブラウザから呼ぶ)");
    const incoming = getRequest().headers;
    const headers: Record<string, string> = {};
    for (const name of [...FORWARDED_HEADERS, clientIpHeader()]) {
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

/**
 * 送って、失敗(4xx / 5xx・届かない・時間切れ)なら投げる。成功なら本文を読む前の応答を返す。
 * untilHeaders … 時間切れを「応答が始まるまで」にだけ掛ける(本文が長く流れる書き出し用)。
 *   ふだんは本文を読み終えるまでを含めて timeoutMs。
 */
async function send(
  method: string,
  path: string,
  body?: unknown,
  opts: { untilHeaders?: boolean } = {},
): Promise<Response> {
  const { side, base, headers, timeoutMs, report, relay } = target(method);
  const timeout = AbortSignal.timeout(timeoutMs);
  let signal = timeout;
  let headersArrived = () => {};
  if (opts.untilHeaders) {
    // 時間切れを別の信号に写し、応答が始まったら写すのをやめる(その後は本文が流れきるまで待つ)
    const untilHeaders = new AbortController();
    const onTimeout = () => untilHeaders.abort(timeout.reason);
    timeout.addEventListener("abort", onTimeout);
    headersArrived = () => timeout.removeEventListener("abort", onTimeout);
    signal = untilHeaders.signal;
  }
  let res: Response;
  try {
    res = await fetch(`${base}/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    const reason =
      cause instanceof DOMException && cause.name === "TimeoutError" ? "timeout" : "unreachable";
    report({ method, path, reason });
    throw new NetworkError(reason, side, { cause });
  } finally {
    headersArrived();
  }
  relay(res);
  if (!res.ok) {
    // ALB が返す 502 / 504 は HTML なので、決まった形でなければ本文は無い扱い
    const parsed = await res.json().catch(() => null);
    // 401 はログインし直せばよいので、記録しない
    if (res.status !== 401) report({ method, path, status: res.status });
    throw new HttpError(res.status, isApiError(parsed) ? parsed : null);
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * データの書き出し(docs/specs/0018-export-stream.md)。API が少しずつ流す JSON を、読み直さずに
 * そのままファイルの中身として受け取る(1社の全部を JS の値にしない)。途中で切れたら NetworkError。
 */
async function download(path: string, body?: unknown): Promise<{ blob: Blob; filename: string }> {
  const res = await send("POST", path, body, { untilHeaders: true });
  const filename =
    res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "export.json";
  try {
    return { blob: await res.blob(), filename };
  } catch (cause) {
    throw new NetworkError("unreachable", "browser", { cause });
  }
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
  // 会社のアカウント(SSO)。SSO のドメインなら IdP へ移る URL(docs/designs/0056-sso-scim-ip-audit-export.md)
  ssoStart: (email: string) => request<SsoStartResult>("POST", "/auth/sso/start", { email }),
  signUp: (email: string, password: string) =>
    request<AuthNext>("POST", "/auth/sign-up", { email, password }),
  // consents … 登録の画面で同意した版(確認コードが通った後に API が記録する)
  confirmSignUp: (email: string, code: string, consents?: LegalVersionRef[]) =>
    request<AuthNext>("POST", "/auth/confirm-sign-up", { email, code, consents }),
  resendCode: (email: string) => request<AuthNext>("POST", "/auth/resend-code", { email }),
  forgotPassword: (email: string) => request<AuthNext>("POST", "/auth/forgot-password", { email }),
  resetPassword: (email: string, code: string, password: string) =>
    request<AuthNext>("POST", "/auth/reset-password", { email, code, password }),
  logout: () => request<void>("POST", "/auth/logout"),
  me: () => request<Me>("GET", "/me"),
  // 所属している組織と、選び直し(docs/specs/0055-multi-org-membership.md)
  listMyOrganizations: () => request<OrganizationMembershipList>("GET", "/me/organizations"),
  switchOrganization: (tenantId: string) =>
    request<{ tenantId: string }>("POST", "/session/organization", { tenantId }),
  // 利用規約・プライバシーポリシーへの同意(docs/specs/0009-legal-consent.md)
  acceptLegal: (consents: LegalVersionRef[]) =>
    request<void>("POST", "/legal/consents", { consents }),
  // 「無くなったら困るか」(docs/specs/0046-pmf-survey.md)。機能フラグ pmf-survey を入れた組織だけ
  pmfSurveyStatus: () => request<PmfSurveyStatus>("GET", "/pmf-survey"),
  answerPmfSurvey: (answer: PmfSurveyAnswer) => request<void>("POST", "/pmf-survey", { answer }),
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
  // 招待(docs/specs/0027-invitations.md)。管理者だけ。受けるのはログインの前(リンクの札で)
  listInvitations: async (): Promise<{ invitations: Invitation[] }> => ({
    invitations: await readPages<InvitationPage, Invitation>("/invitations", (p) => p.invitations),
  }),
  createInvitation: (input: CreateInvitation) => request<Invitation>("POST", "/invitations", input),
  revokeInvitation: (id: string) => request<void>("DELETE", `/invitations/${id}`),
  // 組織のプランと人数(docs/specs/0047-plans.md)。管理者だけ
  getOrganizationPlan: () => request<OrganizationPlan>("GET", "/organization/plan"),
  // 大きなお客さん向けの守り(docs/specs/0056-sso-scim-ip-audit-export.md)
  listDomains: () => request<OrganizationDomainList>("GET", "/organization/domains"),
  createDomain: (domain: string) =>
    request<OrganizationDomain>("POST", "/organization/domains", { domain }),
  verifyDomain: (id: string) =>
    request<OrganizationDomain>("POST", `/organization/domains/${id}/verify`),
  deleteDomain: (id: string) => request<void>("DELETE", `/organization/domains/${id}`),
  getIpAllowlist: () => request<IpAllowlist>("GET", "/organization/ip-allowlist"),
  putIpAllowlist: (cidrs: string[]) =>
    request<IpAllowlist>("PUT", "/organization/ip-allowlist", { cidrs }),
  listMembers: async (): Promise<{ members: OrganizationMember[] }> => ({
    members: await readPages<OrganizationMemberPage, OrganizationMember>(
      "/organization/members",
      (p) => p.members,
    ),
  }),
  signOutMember: (id: string) => request<void>("POST", `/organization/members/${id}/sign-out`),
  // 止める(外す)・戻す・ロールを変える(docs/specs/0079-member-admin.md)
  changeMemberRole: (id: string, role: Role) =>
    request<OrganizationMember>("PUT", `/organization/members/${id}/role`, { role }),
  disableMember: (id: string) =>
    request<OrganizationMember>("POST", `/organization/members/${id}/disable`),
  enableMember: (id: string) =>
    request<OrganizationMember>("POST", `/organization/members/${id}/enable`),
  // SSO の必須と緊急用(プランの機能 sso。IdP をつなぐのは運営)
  getSso: () => request<SsoSettings>("GET", "/organization/sso"),
  putSso: (body: PutSsoSettings) => request<SsoSettings>("PUT", "/organization/sso", body),
  // SCIM の鍵(プランの機能 scim)。鍵は作ったときだけ返る
  listScimTokens: () => request<ScimTokenList>("GET", "/organization/scim-tokens"),
  createScimToken: () => request<CreatedScimToken>("POST", "/organization/scim-tokens"),
  revokeScimToken: (id: string) => request<void>("DELETE", `/organization/scim-tokens/${id}`),
  acceptInvitation: (token: string, name: string) =>
    request<AcceptedInvitation>("POST", "/invitations/accept", { token, name }),
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
  // 組織の「タスクが完了したメール」(管理者だけ。docs/specs/0093-task-mail-switch.md)
  getTaskMail: () => request<TaskMail>("GET", "/organization/task-mail"),
  enableTaskMail: () => request<void>("POST", "/organization/task-mail"),
  disableTaskMail: () => request<void>("DELETE", "/organization/task-mail"),
  // データの書き出し(docs/specs/0005-offboarding.md・0018-export-stream.md)。管理者だけ
  exportData: () => download("/exports"),
  // 監査ログの書き出し(プランの機能 audit-export。docs/specs/0056-sso-scim-ip-audit-export.md の段3)
  exportAuditEvents: (range: AuditExportRequest) => download("/audit-events/export", range),
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
