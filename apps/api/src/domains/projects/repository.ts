import type { Project } from "@app/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import type { TenantScope } from "../../db/scope.ts";
import { projects } from "./schema.ts";

type Row = typeof projects.$inferSelect;
const toProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  createdAt: r.createdAt.toISOString(),
});

export async function listProjects(s: TenantScope): Promise<Project[]> {
  const rows = await s.tx
    .select()
    .from(projects)
    .where(eq(projects.tenantId, s.tenantId))
    .orderBy(desc(projects.createdAt));
  return rows.map(toProject);
}

export async function getProject(s: TenantScope, id: string): Promise<Project | null> {
  const [row] = await s.tx
    .select()
    .from(projects)
    .where(and(eq(projects.tenantId, s.tenantId), eq(projects.id, id)));
  return row ? toProject(row) : null;
}

export async function createProject(s: TenantScope, input: { name: string }): Promise<Project> {
  const [row] = await s.tx
    .insert(projects)
    .values({ tenantId: s.tenantId, name: input.name, createdBy: s.userId })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return toProject(row);
}

export async function deleteProject(s: TenantScope, id: string): Promise<boolean> {
  const rows = await s.tx
    .delete(projects)
    .where(and(eq(projects.tenantId, s.tenantId), eq(projects.id, id)))
    .returning({ id: projects.id });
  return rows.length > 0;
}

/** ほかの領域(tasks)が「このプロジェクトはあるか」を確かめる。 */
export async function projectExists(s: TenantScope, id: string): Promise<boolean> {
  return (await getProject(s, id)) !== null;
}

/** プロジェクトの名前と、作った人(知らせの宛先を決めるため。アウトボックスの受け手が使う) */
export async function findProjectOwner(
  tx: TenantTx,
  tenantId: string,
  id: string,
): Promise<{ name: string; createdBy: string } | null> {
  const [row] = await tx
    .select({ name: projects.name, createdBy: projects.createdBy })
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)));
  return row ?? null;
}

/** データの書き出し(docs/specs/0005-offboarding.md)。自社のプロジェクトを全部(作った人も) */
export async function exportProjects(
  s: TenantScope,
): Promise<{ id: string; name: string; createdBy: string; createdAt: string }[]> {
  const rows = await s.tx
    .select()
    .from(projects)
    .where(eq(projects.tenantId, s.tenantId))
    .orderBy(asc(projects.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  }));
}
