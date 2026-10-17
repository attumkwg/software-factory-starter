import type {
  ApiError,
  CreateProject,
  CreateTask,
  Me,
  Project,
  Task,
  UpdateTask,
} from "@app/shared";

// API の呼び出し。型は packages/shared の契約をそのまま使う。
// 認証は HttpOnly の Cookie(同じオリジン)。トークンを localStorage に置かない。

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.error.message ?? `HTTP ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
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
  createProject: (input: CreateProject) => request<Project>("POST", "/projects", input),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),
  listTasks: (projectId: string) =>
    request<{ tasks: Task[] }>("GET", `/projects/${projectId}/tasks`),
  createTask: (projectId: string, input: CreateTask) =>
    request<Task>("POST", `/projects/${projectId}/tasks`, input),
  updateTask: (id: string, input: UpdateTask) => request<Task>("PATCH", `/tasks/${id}`, input),
  deleteTask: (id: string) => request<void>("DELETE", `/tasks/${id}`),
};
