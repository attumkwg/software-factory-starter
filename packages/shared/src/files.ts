import { z } from "zod";
import { IdSchema } from "./schemas.ts";
import { InstantSchema } from "./time.ts";

// 写真・ファイルの保存(docs/specs/0072-file-storage.md・docs/designs/0072-file-storage.md)。
// 種類と上限は画面と API が同じ値を読む(設計書の U-1・U-2)。

export const FILE_LIMITS = {
  /** 受ける種類(SVG・HTML は置き場の出どころでスクリプトが動くので受けない。HEIC はブラウザで見られない) */
  contentTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  /** 1つの大きさの上限(バイト) */
  maxBytes: 20 * 1024 * 1024,
  /** 署名つき URL の期限(秒) */
  urlTtlSeconds: 300,
  /** 上げ終えない物を一覧から外すまで(時間) */
  pendingHours: 24,
} as const;

export const FileContentTypeSchema = z.enum(FILE_LIMITS.contentTypes);
export type FileContentType = z.infer<typeof FileContentTypeSchema>;

export const FileStatusSchema = z.enum(["pending", "ready", "rejected"]);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const CreateFileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contentType: FileContentTypeSchema,
  byteSize: z.number().int().min(1).max(FILE_LIMITS.maxBytes),
});
export type CreateFile = z.infer<typeof CreateFileSchema>;

export const FileSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  name: z.string(),
  contentType: FileContentTypeSchema,
  byteSize: z.number().int(),
  status: FileStatusSchema,
  uploadedBy: IdSchema,
  createdAt: InstantSchema,
  /** status が ready のときだけ。期限は downloadExpiresAt(過ぎたら、もう一度 API に聞く) */
  downloadUrl: z.url().optional(),
  downloadExpiresAt: InstantSchema.optional(),
});
export type FileView = z.infer<typeof FileSchema>;

export const FilePageSchema = z.object({
  files: z.array(FileSchema),
  nextCursor: z.string().nullable(),
});
export type FilePage = z.infer<typeof FilePageSchema>;

/** 上げる先。画面は headers をそのまま付けて PUT する(種類と大きさは署名に入っている) */
export const FileUploadSchema = z.object({
  url: z.url(),
  method: z.literal("PUT"),
  headers: z.object({ "Content-Type": FileContentTypeSchema, "Content-Length": z.string() }),
  expiresAt: InstantSchema,
});

/** 作ったファイル(id は一番上。監査ログの関所が 201 の本文の id を対象にする)と、上げる先 */
export const CreatedFileSchema = FileSchema.extend({
  upload: FileUploadSchema,
});
export type CreatedFile = z.infer<typeof CreatedFileSchema>;

/** 保存の名前(Content-Disposition)に使えるように、制御文字・道の区切りを _ に置き換える */
export function safeFileName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を落とすための正規表現
  return name.replace(/[\u0000-\u001f\u007f/\\]/g, "_");
}
