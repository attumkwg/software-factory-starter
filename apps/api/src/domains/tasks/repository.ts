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

export async function updateTask(
  s: TenantScope,
  id: string,
  input: UpdateTask,
): Promise<Task | null> {
  const [row] = await s.tx
    .update(tasks)
    .set({ ...input, updatedAt: sql`now()` })
    .where(and(eq(tasks.tenantId, s.tenantId), eq(tasks.id, id)))
    .returning();
  return row ? toTask(row) : null;
}

export async function deleteTask(s: TenantScope, id: string): Promise<boolean> {
  const rows = await s.tx
    .delete(tasks)
    .where(and(eq(tasks.tenantId, s.tenantId), eq(tasks.id, id)))
    .returning({ id: tasks.id });
  return rows.length > 0;
}
