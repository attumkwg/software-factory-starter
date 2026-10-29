import { eq } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import type { TenantScope } from "../../db/scope.ts";
import { tenants } from "./schema.ts";

// 組織の「タスクが完了したメール」を送るか(docs/specs/0093-task-mail-switch.md・docs/designs/0089-task-mail-switch.md)。
// 止める・戻すは管理者だけ(policy.ts の task_mail:manage)。送るかはタスクの領域が、完了した時点(出来事に積む)と送る直前の両方で読む。

export async function getTaskMail(s: TenantScope) {
  return { enabled: await findTaskMailEnabled(s.tx, s.tenantId) };
}

/** その組織が「タスクが完了したメール」を送るか(タスクを完了にするときと、アウトボックスの受け手が送る直前に、組織の文脈で読む) */
export async function findTaskMailEnabled(tx: TenantTx, tenantId: string): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: tenants.taskCompletedMail })
    .from(tenants)
    .where(eq(tenants.tenantId, tenantId));
  return row?.enabled ?? true;
}

export async function setTaskMail(s: TenantScope, enabled: boolean) {
  await s.tx
    .update(tenants)
    .set({ taskCompletedMail: enabled })
    .where(eq(tenants.tenantId, s.tenantId));
}
