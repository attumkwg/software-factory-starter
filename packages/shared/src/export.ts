import { z } from "zod";
import { ExportedFileSchema } from "./files.ts";
import { LegalDocumentSchema } from "./legal.ts";
import { RoleSchema } from "./roles.ts";
import { AuditEventSchema, IdSchema, SupportGrantSchema, TaskSchema } from "./schemas.ts";
import { InstantSchema, TimeZoneSchema } from "./time.ts";

// ── データの書き出し(docs/specs/0005-offboarding.md) ──────────────────────────

/** 書き出しの形の名前と版。形を変えるときは版の数字を上げる(古い書き出しを読む人のため) */
export const EXPORT_FORMAT = "software-factory-starter/export@1";

export const ExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  exportedAt: InstantSchema,
  organization: z.object({
    id: IdSchema,
    name: z.string(),
    timeZone: TimeZoneSchema,
    createdAt: InstantSchema,
    /** 会社のドメイン(確かめた時刻つき)と、組織に入れる IP の範囲(お客さんの設定。docs/specs/0056-sso-scim-ip-audit-export.md) */
    domains: z
      .array(z.object({ domain: z.string(), verifiedAt: InstantSchema.nullable() }))
      .optional(),
    ipAllowlist: z.array(z.string()).optional(),
  }),
  /** 認証の製品の ID(Cognito の sub)は入れない */
  users: z.array(
    z.object({
      id: IdSchema,
      email: z.email(),
      name: z.string(),
      role: RoleSchema,
      createdAt: InstantSchema,
    }),
  ),
  projects: z.array(
    z.object({ id: IdSchema, name: z.string(), createdBy: IdSchema, createdAt: InstantSchema }),
  ),
  tasks: z.array(TaskSchema),
  /** 写真・ファイルの一覧(docs/specs/0072-file-storage.md)。中身・キー・URL は入れない */
  files: z.array(ExportedFileSchema),
  auditEvents: z.array(AuditEventSchema),
  /** サポート番号(のハッシュ)は入れない */
  supportGrants: z.array(SupportGrantSchema),
  /** メールアドレスの変更の申し込み(docs/specs/0006-account-security.md) */
  emailChanges: z.array(
    z.object({
      id: IdSchema,
      userId: IdSchema,
      previousEmail: z.email(),
      newEmail: z.email(),
      requestedAt: InstantSchema,
      confirmedAt: InstantSchema.nullable(),
    }),
  ),
  /** 利用規約・プライバシーポリシーへの同意の記録(docs/specs/0009-legal-consent.md) */
  legalConsents: z.array(
    z.object({
      userId: IdSchema,
      document: LegalDocumentSchema,
      version: z.number().int(),
      capacity: z.enum(["organization", "individual"]),
      source: z.enum(["sign_up", "acceptance"]),
      acceptedAt: InstantSchema,
    }),
  ),
});
export type ExportData = z.infer<typeof ExportSchema>;
