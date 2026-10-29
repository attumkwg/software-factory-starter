import { DEFAULT_TIME_ZONE, ROLES } from "@app/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  pgSchema,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, instant } from "../../db/columns.ts";

// 領域「組織」(docs/domain/organizations)。Postgres のスキーマ organizations に置く。
// ほかの領域は、この表を外部キーで指してよい(組織と人は全領域の土台)。読むときは index.ts の関数を通す。

export const organizations = pgSchema("organizations");

export const roleEnum = organizations.enum("role", ROLES);

export const tenants = organizations.table("tenants", {
  tenantId: id("tenant_id"),
  name: text("name").notNull(),
  // 画面で時刻を見せる時間帯・「1日」の区切り(ADR 0005)。IANA の名前("Asia/Tokyo")。
  // 正しい名前かはアプリ(@app/shared の TimeZoneSchema)で確かめる
  timeZone: text("time_zone").notNull().default(DEFAULT_TIME_ZONE),
  // この組織では全員に二段階認証を必須にする(docs/specs/0006-account-security.md)。管理者が入れ・切る。
  // 運営の組織(SUPPORT_TENANT_ID)は最初から true で、切れない
  mfaRequired: boolean("mfa_required").notNull().default(false),
  // この組織で「タスクが完了したメール」を送るか(docs/specs/0093-task-mail-switch.md)。管理者が止め・戻す。
  // 送る直前に読む(tasks の taskCompletedMail)。既定は送る
  taskCompletedMail: boolean("task_completed_mail").notNull().default(true),
  createdAt: createdAt(),
});

export const users = organizations.table(
  "users",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    // いまは「1人 = 1組織」。複数の組織に入る人は、組織ごとに行を持つ(ADR 0001 の今後)
    email: text("email").notNull(),
    // 認証の製品(Cognito)側の ID(sub)
    externalId: text("external_id"),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    // 二段階認証が有効か(正は Cognito。ログインと確かめ直しのたびに写し直す)。関所が「設定待ち」を決めるのに使う
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    // これより前にログインしたセッションの Cookie は使えない(パスワードなどを変えたら、ほかの端末を切る)
    sessionsValidAfter: instant("sessions_valid_after"),
    // その組織に最後に入った(ログイン・組織の切り替え)時刻。ログインで「前回の組織」を選ぶ(docs/specs/0055-multi-org-membership.md)
    lastUsedAt: instant("last_used_at"),
    // SSO を必須にした組織の緊急用のアカウント(IdP が止まったときにパスワードで入れる)。1組織 2人まで・管理者だけ・
    // 二段階認証が必須(docs/designs/0056-sso-scim-ip-audit-export.md の U-3)。管理者が設定の画面で選ぶ
    ssoExempt: boolean("sso_exempt").notNull().default(false),
    // SCIM(情シスの道具)で止めた時刻。止めた人は関所もログインも通らない(行と監査ログは残す。設計書 0056 の U-5)
    disabledAt: instant("disabled_at"),
    // 情シスの道具の側の人の ID(SCIM の externalId)。道具が自分の人と結びつけるのに使う
    scimExternalId: text("scim_external_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("users_tenant_id_id_key").on(t.tenantId, t.id),
    // 組織ごとの一意。同じ人(メール・Cognito の sub)が複数の組織に所属できる(ADR 0066。全体の一意は移行 0019 で消した)
    uniqueIndex("users_tenant_email_key").on(t.tenantId, t.email),
    uniqueIndex("users_tenant_external_id_key").on(t.tenantId, t.externalId),
  ],
);

// ── サポートの代理ログイン(docs/specs/0004-support-access.md・ADR 0014) ─────────────────

/**
 * お客さんの管理者が出した「サポートに見せてよい」の許可。番号そのものは持たない(ハッシュだけ)。
 * 社員が番号から許可を探すのは、移行 0007 の関数(support_find_grant)だけ(アプリは全社分を読めない)。
 */
export const supportGrants = organizations.table(
  "support_grants",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    grantedBy: uuid("granted_by").notNull(),
    /** サポート番号の SHA-256(16進)。番号は画面に1回だけ出して、保存しない */
    codeHash: text("code_hash").notNull(),
    createdAt: createdAt(),
    expiresAt: instant("expires_at").notNull(),
    revokedAt: instant("revoked_at"),
    revokedBy: uuid("revoked_by"),
  },
  (t) => [
    unique("support_grants_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("support_grants_code_hash_key").on(t.codeHash),
    foreignKey({
      name: "support_grants_granted_by_fkey",
      columns: [t.tenantId, t.grantedBy],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

/**
 * 社員が入っている間の記録(入室)。代理の Cookie はこの ID を持ち、認可の関所が毎回
 * 「終わっていない・期限内・許可が取り消されていない」を確かめる。
 * 社員は運営の組織の人なので、users への外部キーは張らない(名前とメールを写しておく)。
 */
export const supportSessions = organizations.table(
  "support_sessions",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    grantId: uuid("grant_id").notNull(),
    staffUserId: uuid("staff_user_id").notNull(),
    staffName: text("staff_name").notNull(),
    staffEmail: text("staff_email").notNull(),
    startedAt: instant("started_at").notNull().defaultNow(),
    expiresAt: instant("expires_at").notNull(),
    endedAt: instant("ended_at"),
  },
  (t) => [
    foreignKey({
      name: "support_sessions_grant_fkey",
      columns: [t.tenantId, t.grantId],
      foreignColumns: [supportGrants.tenantId, supportGrants.id],
    }),
  ],
);

// ── メールアドレスの変更(docs/specs/0006-account-security.md) ─────────────────────────────

/**
 * 本人がメールアドレスの変更を申し込んだ記録。生きているのは本人の最新の1件で、確認していない・24時間以内の物。
 * 古いアドレス(previous_email)は、変わったときのお知らせの宛先(出来事の中身にメールを入れないため、ここに持つ)。
 */
export const emailChanges = organizations.table(
  "email_changes",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    userId: uuid("user_id").notNull(),
    previousEmail: text("previous_email").notNull(),
    newEmail: text("new_email").notNull(),
    requestedAt: instant("requested_at").notNull().defaultNow(),
    confirmedAt: instant("confirmed_at"),
  },
  (t) => [
    foreignKey({
      name: "email_changes_user_fkey",
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
    index("email_changes_user_idx").on(t.tenantId, t.userId, t.requestedAt.desc()),
  ],
);

// ── 招待(docs/specs/0027-invitations.md・ADR 0040) ──────────────────────────────────────

/**
 * 管理者が出した招待。リンクの札は持たない(招待の ID と、サーバーの秘密から作った署名で、その場で作り・確かめる)。
 * 生きているのは、受けていない・取り消していない・期限内の物。受けた・取り消したら、もう使えない(1回きり)。
 * 運営のコマンドが作った組織の最初の管理者は招待ではない(invited_by が無い招待は作らない)。
 */
export const invitations = organizations.table(
  "invitations",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    invitedBy: uuid("invited_by").notNull(),
    createdAt: createdAt(),
    expiresAt: instant("expires_at").notNull(),
    acceptedAt: instant("accepted_at"),
    acceptedUserId: uuid("accepted_user_id"),
    revokedAt: instant("revoked_at"),
    revokedBy: uuid("revoked_by"),
  },
  (t) => [
    unique("invitations_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "invitations_invited_by_fkey",
      columns: [t.tenantId, t.invitedBy],
      foreignColumns: [users.tenantId, users.id],
    }),
    // 一覧(新しい順)と、同じメールの生きている招待を探す
    index("invitations_list_idx").on(t.tenantId, t.createdAt.desc(), t.id.desc()),
    index("invitations_email_idx").on(t.tenantId, t.email),
  ],
);

// ── 大きなお客さん向けの守り(docs/specs/0056-sso-scim-ip-audit-export.md・ADR 0067) ─────────────

/**
 * 組織が登録した会社のドメイン。DNS の TXT(_sfs-verify.<ドメイン>)に verify_token を置いてもらい、見えたら確かめた(T-8)。
 * 確かめたドメインは全体で1つの組織だけ(下の一意の索引。RLS は一意に効かないので、他社とも重ならない)。
 * verify_token は DNS に置く公開の文字(秘密ではない)。
 */
export const domains = organizations.table(
  "domains",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    domain: text("domain").notNull(),
    verifyToken: text("verify_token").notNull(),
    verifiedAt: instant("verified_at"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => [
    unique("domains_tenant_id_id_key").on(t.tenantId, t.id),
    // 同じ組織に同じドメインは1つ
    uniqueIndex("domains_tenant_domain_key").on(t.tenantId, t.domain),
    // 確かめたドメインは全体で1つの組織だけ
    uniqueIndex("domains_verified_domain_key").on(t.domain).where(sql`verified_at is not null`),
    foreignKey({
      name: "domains_created_by_fkey",
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

/**
 * 組織に入れる IP の範囲(CIDR)。1組織 20 まで(アプリで数える)。1行も無ければ制限しない。
 * 認可の関所が毎回、セッションの組織の一覧に、いまの IP が入っているかを見る(代理の社員は見ない。設計書 0056 の U-4)。
 */
export const ipAllowlist = organizations.table(
  "ip_allowlist",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    cidr: text("cidr").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => [
    index("ip_allowlist_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "ip_allowlist_created_by_fkey",
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

/**
 * 組織につないだ SAML の IdP(Cognito の IdP の名前)。1組織に1つ。つなぐ・外すのは運営のコマンド(sso-connect。設計書 0056 の U-1)、
 * 必須にする・外すのは管理者(API)。組織を決めるのは IdP の名前で、メールのドメインは「確かめたドメインか」の確かめにだけ使う(T-8・L-8)。
 */
export const ssoConnections = organizations.table(
  "sso_connections",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    providerName: text("provider_name").notNull(),
    required: boolean("required").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: instant("updated_at"),
  },
  (t) => [
    // 1組織に1つ・1つの IdP は1つの組織だけ
    uniqueIndex("sso_connections_tenant_key").on(t.tenantId),
    uniqueIndex("sso_connections_provider_key").on(t.providerName),
  ],
);

/**
 * SCIM の鍵(情シスの道具が人を作る・止めるのに使う。docs/designs/0056-sso-scim-ip-audit-export.md の 2・段2)。
 * 鍵そのものは持たない(SHA-256 のハッシュだけ。作ったときに画面に1回だけ出す)。鍵から組織を引くのは、
 * 移行 0022 の関数(auth_find_scim_token)だけ(アプリは全社分を読めない)。取り消した鍵は戻らない。
 */
export const scimTokens = organizations.table(
  "scim_tokens",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by").notNull(),
    lastUsedAt: instant("last_used_at"),
    revokedAt: instant("revoked_at"),
    revokedBy: uuid("revoked_by"),
  },
  (t) => [
    unique("scim_tokens_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("scim_tokens_token_hash_key").on(t.tokenHash),
    index("scim_tokens_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "scim_tokens_created_by_fkey",
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }),
    foreignKey({
      name: "scim_tokens_revoked_by_fkey",
      columns: [t.tenantId, t.revokedBy],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);
