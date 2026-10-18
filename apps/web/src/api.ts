import type {
  ApiError,
  CreateProject,
  CreateTask,
  Me,
  Project,
  Task,
  UpdateTask,
} from "@app/shared";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// API の呼び出し。型は packages/shared の契約をそのまま使う。
// 認証は HttpOnly の Cookie(同じオリジン)。トークンを localStorage に置かない。
//
// 同じ関数が2か所で動く(TanStack Start の loader は SSR とブラウザの両方で動く):
//   ブラウザ … /api へ(ALB が API のサービスへ振り分ける)。Cookie はブラウザが付ける
//   SSR     … API_INTERNAL_URL へ直接(ECS の Service Connect)。来た Cookie と request ID を渡す
// SSR から API を呼ぶのは読み取り(GET)だけ。書き込みは必ずブラウザから(CSRF の守りを通す)。

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.error.message ?? `HTTP ${status}`);
  }
}

type Target = { base: string; headers: Record<string, string> };

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
    return { base: process.env.API_INTERNAL_URL ?? "http://localhost:3000", headers };
  })
  .client((_method: string): Target => ({ base: "", headers: {} }));

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { base, headers } = target(method);
  const res = await fetch(`${base}/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as ApiError | null;
    throw new HttpError(res.status, parsed);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  devLogin: (email: string) => request<{ ok: true }>("POST", "/auth/dev-login", { email }),
  logout: () => request<void>("POST", "/auth/logout"),
  me: () => request<Me>("GET", "/me"),
  listProjects: () => request<{ projects: Project[] }>("GET", "/projects"),
  getProject: (id: string) => request<Project>("GET", `/projects/${id}`),
  createProject: (input: CreateProject) => request<Project>("POST", "/projects", input),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),
  listTasks: (projectId: string) =>
    request<{ tasks: Task[] }>("GET", `/projects/${projectId}/tasks`),
  createTask: (projectId: string, input: CreateTask) =>
    request<Task>("POST", `/projects/${projectId}/tasks`, input),
  updateTask: (id: string, input: UpdateTask) => request<Task>("PATCH", `/tasks/${id}`, input),
  deleteTask: (id: string) => request<void>("DELETE", `/tasks/${id}`),
};
