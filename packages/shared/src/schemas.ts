import { z } from "zod";
import { RoleSchema } from "./roles.ts";
import { InstantSchema, TimeZoneSchema } from "./time.ts";

// 画面と API で共有する「契約」。API はここから OpenAPI を作り、画面は型として使う。
// 項目は足すだけ・消さない・意味を変えない(古い画面やアプリから呼ばれても壊れないように)。

export const IdSchema = z.uuid();

export const MeSchema = z.object({
  userId: IdSchema,
  tenantId: IdSchema,
  tenantName: z.string(),
  email: z.email(),
  name: z.string(),
  role: RoleSchema,
  /** 組織の時間帯。画面はこの時間帯で時刻を見せる(SSR とブラウザで同じになる) */
  timeZone: TimeZoneSchema,
  /** 社員の代理ログインの最中なら、その入室の期限(画面は上に帯を出す。role は閲覧者) */
  support: z.object({ expiresAt: InstantSchema }).optional(),
  /** 運営の組織の人(サポート番号で代理ログインできる)なら true */
  isSupportStaff: z.boolean().optional(),
});
export type Me = z.infer<typeof MeSchema>;

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string(),
  createdAt: InstantSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;

export const TaskSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string(),
  done: z.boolean(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
});
export type CreateTask = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    done: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.done !== undefined, {
    message: "title か done のどちらかが必要です",
  });
export type UpdateTask = z.infer<typeof UpdateTaskSchema>;

// ── 一覧のページング(docs/guides/api-changes.md「一覧は必ずページング」) ──────────
// 増え続ける一覧は、1回に返す件数に上限を付け、続きは nextCursor で読む(全件を一度に返さない)。

/** 1回に返す件数。limit を渡さなければ default、渡せるのは max まで */
export const PAGE_LIMIT = { default: 50, max: 100 } as const;

export const ProjectPageSchema = z.object({
  projects: z.array(ProjectSchema),
  /** 続きを読むときに cursor に渡す。無ければ終わり */
  nextCursor: z.string().nullable(),
});
export type ProjectPage = z.infer<typeof ProjectPageSchema>;

export const TaskPageSchema = z.object({
  tasks: z.array(TaskSchema),
  /** 続きを読むときに cursor に渡す。無ければ終わり */
  nextCursor: z.string().nullable(),
});
export type TaskPage = z.infer<typeof TaskPageSchema>;

/**
 * 失敗の種類。画面・スマホはこの code で分岐する(message は人が読む説明で、変わりうる)。
 * 足すのはよいが、消す・意味を変えるのはしない(古い画面が残るため)。
 */
export const ERROR_CODES = [
  "bad_request", // 入力が正しくない(400)
  "unauthorized", // ログインしていない(401)
  "login_failed", // ログインできなかった(401)
  "forbidden", // 権限が無い(403)
  "not_found", // 無い・他社の物(404)
  "conflict", // ほかの変更とぶつかった(409)。読み直して、やり直せば通ることがある
  "payload_too_large", // 本文が大きすぎる(413)
  "unsupported_media_type", // 本文が JSON ではない(415)
  "service_unavailable", // DB などが一時的に使えない(503)。少し待てば通る
  "internal", // それ以外の想定外(500)
  "invalid_code", // 確認コード・二段階認証のコードが違う・切れた(400)
  "invalid_password", // パスワードが決まり(cognito-settings.json)を満たさない(400)
  "too_many_requests", // 短い間に試しすぎた(429)。少し待てば通る
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// OpenAPI では code を「増えることがある一覧」(x-extensible-enum)として書く。enum にすると、code を足しただけで
// 互換の検査(oasdiff)が「壊す変更」と判定する(足すのは、してよい変更。docs/guides/api-changes.md)。
// 画面・アプリは知らない code が来ても動くように書く(apps/web/src/errors.ts)。
const ExtensibleErrorCode = z.string().meta({
  description:
    "失敗の種類(ERROR_CODES)。増えることがある。知らない値は「うまくいきませんでした」として扱う",
  "x-extensible-enum": [...ERROR_CODES],
});

export const ErrorSchema = z.object({
  error: z.object({
    code: ExtensibleErrorCode,
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
/** 失敗の本文の型(code はこの版で知っている物。古い版の画面には知らない code が届きうる) */
export type ApiError = { error: { code: ErrorCode; message: string; requestId?: string } };

export const DevLoginSchema = z.object({
  email: z.email(),
});

// ── サポートの代理ログイン(docs/specs/0004-support-access.md) ─────────────────────

/** 許可の長さ(時間)。画面は 1時間・24時間・3日 から選ぶ */
export const SUPPORT_GRANT_HOURS = [1, 24, 72] as const;

export const SupportGrantSchema = z.object({
  id: IdSchema,
  createdAt: InstantSchema,
  expiresAt: InstantSchema,
  revokedAt: InstantSchema.nullable(),
  status: z.enum(["active", "expired", "revoked"]),
});
export type SupportGrant = z.infer<typeof SupportGrantSchema>;

export const CreateSupportGrantSchema = z.object({
  hours: z.union(SUPPORT_GRANT_HOURS.map((h) => z.literal(h))),
});
export type CreateSupportGrant = z.infer<typeof CreateSupportGrantSchema>;

/** 作ったときだけ番号が返る(保存しないので二度と出ない) */
export const CreatedSupportGrantSchema = SupportGrantSchema.extend({ code: z.string() });
export type CreatedSupportGrant = z.infer<typeof CreatedSupportGrantSchema>;

export const StartSupportSchema = z.object({ code: z.string().trim().min(1).max(30) });
export type StartSupport = z.infer<typeof StartSupportSchema>;

export const SupportSessionSchema = z.object({
  id: IdSchema,
  tenantName: z.string(),
  expiresAt: InstantSchema,
});
export type SupportSession = z.infer<typeof SupportSessionSchema>;

// ── 監査ログ(docs/specs/0003-audit-log.md) ─────────────────────────────────

/** 誰が: 自社の人 / 代理ログインの社員(サポート) / 仕組み */
export const AUDIT_ACTOR_KINDS = ["user", "support", "system"] as const;

export const AuditEventSchema = z.object({
  id: IdSchema,
  occurredAt: InstantSchema,
  actor: z.object({
    kind: z.enum(AUDIT_ACTOR_KINDS),
    id: IdSchema.nullable(),
    /** 自社の人なら名前。社員・仕組み・消された人は null(画面は kind で出し分ける) */
    name: z.string().nullable(),
  }),
  /** 何をしたか(「対象.動作」。例 project.create)。画面は名前から文を選ぶ */
  action: z.string(),
  target: z.object({ type: z.string(), id: IdSchema }).nullable(),
  outcome: z.enum(["allowed", "denied"]),
  requestId: z.string().nullable(),
  /** 直した項目の名前など(値は入らない) */
  details: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditEventPageSchema = z.object({
  events: z.array(AuditEventSchema),
  /** 続きを読むときに before に渡す。無ければ終わり */
  nextCursor: z.string().nullable(),
});
export type AuditEventPage = z.infer<typeof AuditEventPageSchema>;

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
  auditEvents: z.array(AuditEventSchema),
  /** サポート番号(のハッシュ)は入れない */
  supportGrants: z.array(SupportGrantSchema),
});
export type ExportData = z.infer<typeof ExportSchema>;

/**
 * ログインの方式(GET /api/auth/options)。画面はこれを見て、ログインとログアウトの出し方を変える。
 *   dev     … 開発用ログイン(local / test / preview だけ)
 *   cognito … Cognito の画面へ移る。logoutUrl は Cognito 側のログインも終わらせる行き先
 */
export const AuthOptionsSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("dev") }),
  z.object({ method: z.literal("cognito"), logoutUrl: z.url() }),
]);
export type AuthOptions = z.infer<typeof AuthOptionsSchema>;

/**
 * ログインの後に戻る先。**アプリの中のパスだけ**を通す(よそのサイトへ飛ばされる穴を作らない)。
 * 「/」で始まり、「//」「/\」(よそのサイトの意味になる)・/api・制御文字・長すぎるものは「/」にする。
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  // ブラウザは「\」を「/」と読むので、「/\evil.example」もよそのサイトになる。どこにあっても弾く
  if (value.includes("\\")) return "/";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を見つけて弾くため
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  if (value === "/api" || value.startsWith("/api/") || value.startsWith("/api?")) return "/";
  if (value === "/login" || value.startsWith("/login?")) return "/";
  return value;
}
