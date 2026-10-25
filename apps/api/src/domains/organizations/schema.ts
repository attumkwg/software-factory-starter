import { DEFAULT_TIME_ZONE, ROLES } from "@app/shared";
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
    createdAt: createdAt(),
  },
  (t) => [
    unique("users_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_external_id_key").on(t.externalId),
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
