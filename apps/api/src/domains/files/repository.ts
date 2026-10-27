import {
  type CreateFile,
  FILE_LIMITS,
  type FileContentType,
  type FileStatus,
  type FileView,
} from "@app/shared";
import { and, asc, eq, getTableColumns, gt, ne, or, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import { beyondCursor, cursorTime, decodeCursor, toPage } from "../../db/paging.ts";
import type { TenantScope } from "../../db/scope.ts";
import { enqueue } from "../../outbox/index.ts";
import { files } from "./schema.ts";

// ファイルの目録の読み書き(docs/designs/0072-file-storage.md の 2・3)。中身(S3)には触らない。

type Row = typeof files.$inferSelect;
export type FileRow = Row;

export const toFileView = (r: Row): FileView => ({
  id: r.id,
  taskId: r.taskId,
  name: r.name,
  contentType: r.contentType as FileContentType,
  byteSize: r.byteSize,
  status: r.status as FileStatus,
  uploadedBy: r.uploadedBy,
  createdAt: r.createdAt.toISOString(),
});

/** 上げ終えない物(pending のまま24時間)は一覧に出さない */
const notAbandoned = () =>
  or(
    ne(files.status, "pending"),
    gt(files.createdAt, sql`now() - make_interval(hours => ${FILE_LIMITS.pendingHours})`),
  );

/** タスクのファイル(古い順)。cursor は前のページの nextCursor */
export async function listFiles(
  s: TenantScope,
  taskId: string,
  opts: { cursor?: string | undefined; limit: number },
): Promise<{ rows: Row[]; nextCursor: string | null }> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await s.tx
    .select({ ...getTableColumns(files), cursorAt: cursorTime(files.createdAt) })
    .from(files)
    .where(
      and(
        eq(files.tenantId, s.tenantId),
        eq(files.taskId, taskId),
        notAbandoned(),
        beyondCursor(cursor, "asc", files.createdAt, files.id),
      ),
    )
    .orderBy(asc(files.createdAt), asc(files.id))
    .limit(opts.limit + 1);
  const page = toPage(rows, opts.limit, (r) => ({ at: r.cursorAt, id: r.id }));
  return { rows: page.rows, nextCursor: page.nextCursor };
}

export async function findFile(s: TenantScope, id: string): Promise<Row | null> {
  const [row] = await s.tx
    .select()
    .from(files)
    .where(and(eq(files.tenantId, s.tenantId), eq(files.id, id)));
  return row ?? null;
}

export async function createFile(s: TenantScope, taskId: string, input: CreateFile): Promise<Row> {
  const [row] = await s.tx
    .insert(files)
    .values({
      tenantId: s.tenantId,
      taskId,
      uploadedBy: s.userId,
      name: input.name,
      contentType: input.contentType,
      byteSize: input.byteSize,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** 上げ終えた: pending なら書き直しを頼む(2回呼んでも1回だけ積むよう、積んだかは見ない。受け手が2回目を捨てる) */
export async function requestProcessing(s: TenantScope, file: Row): Promise<void> {
  if (file.status !== "pending") return;
  await enqueue(s, "files.file_uploaded", { fileId: file.id });
}

/** 行を消す(引き金が files.file_deleted を積む)。消せたら true */
export async function deleteFile(s: TenantScope, id: string): Promise<boolean> {
  const rows = await s.tx
    .delete(files)
    .where(and(eq(files.tenantId, s.tenantId), eq(files.id, id)))
    .returning({ id: files.id });
  return rows.length > 0;
}

// ── 送り出し(アウトボックスの受け手)が使う ──

export async function findFileForProcessing(
  tx: TenantTx,
  tenantId: string,
  id: string,
): Promise<Row | null> {
  const [row] = await tx
    .select()
    .from(files)
    .where(and(eq(files.tenantId, tenantId), eq(files.id, id)));
  return row ?? null;
}

/** 書き直しの結果。pending の行だけを変える(2回届いても、先に決まった結果を変えない) */
export async function settleFile(
  tx: TenantTx,
  tenantId: string,
  id: string,
  result: { status: "ready"; storedByteSize: number } | { status: "rejected" },
): Promise<boolean> {
  const rows = await tx
    .update(files)
    .set(
      result.status === "ready"
        ? { status: "ready", storedByteSize: result.storedByteSize, readyAt: sql`now()` }
        : { status: "rejected" },
    )
    .where(and(eq(files.tenantId, tenantId), eq(files.id, id), eq(files.status, "pending")))
    .returning({ id: files.id });
  return rows.length > 0;
}
