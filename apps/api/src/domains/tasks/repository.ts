import type { Task, TaskPage, UpdateTask } from "@app/shared";
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { beyondCursor, cursorTime, decodeCursor, toPage } from "../../db/paging.ts";
import type { TenantScope } from "../../db/scope.ts";
import { tasks } from "./schema.ts";

type Row = typeof tasks.$inferSelect;
const toTask = (r: Row): Task => ({
  id: r.id,
  projectId: r.projectId,
  title: r.title,
  done: r.done,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** 古い順。cursor は前のページの nextCursor(索引 tasks_tenant_id_project_id_created_at_id_idx の順) */
export async function listTasks(
  s: TenantScope,
  projectId: string,
  opts: { cursor?: string | undefined; limit: number },
): Promise<TaskPage> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await s.tx
    .select({ ...getTableColumns(tasks), cursorAt: cursorTime(tasks.createdAt) })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, s.tenantId),
        eq(tasks.projectId, projectId),
        beyondCursor(cursor, "asc", tasks.createdAt, tasks.id),
      ),
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id))
    .limit(opts.limit + 1);
  const page = toPage(rows, opts.limit, (r) => ({ at: r.cursorAt, id: r.id }));
  return { tasks: page.rows.map(toTask), nextCursor: page.nextCursor };
}

export async function createTask(
  s: TenantScope,
  projectId: string,
  input: { title: string },
): Promise<Task> {
  const [row] = await s.tx
    .insert(tasks)
    .values({ tenantId: s.tenantId, projectId, title: input.title })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return toTask(row);
}

/** 直す。completedNow … この変更で「未完了 → 完了」になったか(出来事を積むかの判断に使う)。 */
export async function updateTask(
  s: TenantScope,
  id: string,
  input: UpdateTask,
): Promise<{ task: Task; completedNow: boolean } | null> {
  // 前の状態を読んで、同じトランザクションの中で行を押さえる(同時に2人が完了にしても、出来事は1回)
  const [before] = await s.tx
    .select({ done: tasks.done })
    .from(tasks)
    .where(and(eq(tasks.tenantId, s.tenantId), eq(tasks.id, id)))
    .for("update");
  if (!before) return null;
  const [row] = await s.tx
    .update(tasks)
    .set({ ...input, updatedAt: sql`now()` })
    .where(and(eq(tasks.tenantId, s.tenantId), eq(tasks.id, id)))
    .returning();
  if (!row) return null;
  return { task: toTask(row), completedNow: !before.done && row.done };
}

export async function deleteTask(s: TenantScope, id: string): Promise<boolean> {
  const rows = await s.tx
    .delete(tasks)
    .where(and(eq(tasks.tenantId, s.tenantId), eq(tasks.id, id)))
    .returning({ id: tasks.id });
  return rows.length > 0;
}

/** データの書き出し(docs/specs/0005-offboarding.md)。自社のタスクを全部 */
export async function exportTasks(s: TenantScope): Promise<Task[]> {
  const rows = await s.tx
    .select()
    .from(tasks)
    .where(eq(tasks.tenantId, s.tenantId))
    .orderBy(asc(tasks.createdAt));
  return rows.map(toTask);
}
