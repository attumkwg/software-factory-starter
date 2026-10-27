import { FILE_LIMITS, type FileContentType, safeFileName } from "@app/shared";
import type { TenantTx } from "../../db/client.ts";
import type { Logger } from "../../logger.ts";
import { OUTBOX_TOPICS, type OutboxEvent } from "../../outbox/index.ts";
import {
  BrokenFileError,
  detectContentType,
  type ObjectStore,
  stripMetadata,
} from "../../storage/index.ts";
import { type FileRow, findFileForProcessing, settleFile } from "./repository.ts";

// アウトボックスの受け手(docs/designs/0072-file-storage.md の 5・ADR 0080)。
// 組織は出来事の tenantId から作り直す(T-4・L-5)。同じ出来事が2回届いても大丈夫に書く。
// 置き場を待つのは DB のトランザクションの外だけ。

/**
 * 組織の文脈つきの短いトランザクションを開く関数。領域の中では接続を持たないので、外(送り出し・app.ts)が
 * `withTenant(db, …)` を包んで渡す(Semgrep の tenant-scoped-db-only)
 */
export type InTenantTx = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) => Promise<T>;

export type FileProcessDeps = { inTenant: InTenantTx; logger: Logger; store: ObjectStore };

/** 保存の名前。写真はその場で見せ、PDF は保存させる(ファイル名は URL に入れず、ここに入れる) */
function contentDisposition(type: FileContentType, name: string): string {
  const kind = type === "application/pdf" ? "attachment" : "inline";
  return `${kind}; filename*=UTF-8''${encodeURIComponent(safeFileName(name))}`;
}

/** 上げた物を確かめて、見せる中身を作る。断るなら理由(ログに出す決まった文字列) */
function prepare(
  read: Awaited<ReturnType<ObjectStore["readIncoming"]>>,
  file: FileRow,
): { body: Uint8Array } | { reject: string } {
  // 上げていないのに上げ終えたと言った(上げ直しは新しいファイルで)
  if (!read) return { reject: "not_uploaded" };
  if ("tooLarge" in read) return { reject: "too_large" };
  if (read.body.length !== file.byteSize) return { reject: "size_mismatch" };
  const type = file.contentType as FileContentType;
  if (detectContentType(read.body) !== type) return { reject: "type_mismatch" };
  try {
    return { body: stripMetadata(read.body, type) };
  } catch (e) {
    if (e instanceof BrokenFileError) return { reject: "broken" };
    throw e;
  }
}

/** files.file_uploaded: 上げた物を読み直し、種類を確かめて付いた情報を消し、見せる置き場へ書く */
export function handleFileUploaded(deps: FileProcessDeps) {
  const { inTenant, logger, store } = deps;
  return async (event: OutboxEvent) => {
    const { fileId } = OUTBOX_TOPICS["files.file_uploaded"].parse(event.payload);
    const { tenantId } = event;
    const settle = (result: Parameters<typeof settleFile>[3]) =>
      inTenant(tenantId, (tx) => settleFile(tx, tenantId, fileId, result));
    const file = await inTenant(tenantId, (tx) => findFileForProcessing(tx, tenantId, fileId));
    // 消された・もう決まった(2回目)物は何もしない
    if (file?.status !== "pending") return;

    const prepared = prepare(
      await store.readIncoming(tenantId, fileId, FILE_LIMITS.maxBytes),
      file,
    );
    if ("reject" in prepared) {
      await store.removeIncoming(tenantId, fileId);
      await settle({ status: "rejected" });
      logger.info(
        { eventId: event.id, fileId, reason: prepared.reject },
        "上げたファイルを断りました",
      );
      return;
    }
    const type = file.contentType as FileContentType;
    await store.writeFile(tenantId, fileId, prepared.body, {
      contentType: type,
      contentDisposition: contentDisposition(type, file.name),
    });
    await store.removeIncoming(tenantId, fileId);
    const settled = await settle({ status: "ready", storedByteSize: prepared.body.length });
    // 書いている間に消された: 行が無いので、書いた中身も消す(消した出来事の受け手が先に走っていても残さない)
    if (!settled) await store.remove(tenantId, fileId);
    // ログの項目は許可リスト(packages/logging)にある物だけ。名前・キー・URL は出さない
    logger.info(
      { eventId: event.id, fileId, reason: settled ? "ready" : "deleted_meanwhile" },
      "上げたファイルを見られるようにしました",
    );
  };
}

/** files.file_deleted: 置き場の今の版を消す(前の版はライフサイクルで消える)。無くても成功 */
export function handleFileDeleted(deps: Pick<FileProcessDeps, "store">) {
  return async (event: OutboxEvent) => {
    const { fileId } = OUTBOX_TOPICS["files.file_deleted"].parse(event.payload);
    await deps.store.remove(event.tenantId, fileId);
  };
}
