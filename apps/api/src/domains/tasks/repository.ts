import type { Task, UpdateTask } from "@app/shared";
import { and, asc, eq, sql } from "drizzle-orm";
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

export async function listTasks(s: TenantScope, projectId: string): Promise<Task[]> {
  const rows = await s.tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, s.tenantId), eq(tasks.projectId, projectId)))
    .orderBy(asc(tasks.createdAt));
  return rows.map(toTask);
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
