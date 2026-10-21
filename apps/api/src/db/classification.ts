// 列の分類表(個人情報の台帳の元。docs/specs/0008-personal-data.md・ADR 0018)。
// DB の全部の列に、区分と利用目的の一言を書く。列を足したら、ここにも1行足す
// (無ければ test/unit/classification.test.ts が落ちる)。区分を変える・sensitive を足すのは人の確認が要る(危険度「高」)。
//
// 区分:
//   public    … 決まった選択肢・真偽(ロールの種類・状態・時間帯)。誰の物かを除けば意味が無い
//   internal  … 仕組みの値(ID・ハッシュ・時刻・回数)。ID は単体では人が分からない。ログに出してよい
//   personal  … 個人情報か、お客さんが入れた自由な文(名前・メールアドレス・題名)。ログ・監査ログ・送信待ち・Sentry に出さない
//   sensitive … 要配慮個人情報(病歴・障害・信条・犯罪の経歴など。個人情報保護法 2条3項)。
//               スキーマ sensitive の表にだけ置ける(いまは無いので足せない。分ける段は ADR 0018)
//
// 台帳(docs/db/personal-data.md)は、ここから `pnpm docs:personal-data` で作る(手で書かない)。

export const DATA_CLASSES = ["public", "internal", "personal", "sensitive"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** 要配慮個人情報を置いてよい、ただ1つの Postgres のスキーマ(ADR 0018 の段1で作る) */
export const SENSITIVE_SCHEMA = "sensitive";

export type FieldClass = {
  class: DataClass;
  /** 何のために持つか(一言) */
  purpose: string;
};

export type ColumnClass = FieldClass & {
  /** jsonb の列だけ: 中身のキーごとの区分 */
  keys?: Record<string, FieldClass>;
};

const pub = (purpose: string): FieldClass => ({ class: "public", purpose });
const internal = (purpose: string): FieldClass => ({ class: "internal", purpose });
const personal = (purpose: string): FieldClass => ({ class: "personal", purpose });

/** 「スキーマ.表.列」→ 区分と目的 */
export const COLUMN_CLASSIFICATION: Record<string, ColumnClass> = {
  // ── 組織(organizations) ──
  "organizations.tenants.tenant_id": internal("組織の ID"),
  "organizations.tenants.name": personal("組織の名前を画面に出す(個人事業主なら人の名前になる)"),
  "organizations.tenants.time_zone": pub("時刻を見せる時間帯・「1日」の区切り"),
  "organizations.tenants.mfa_required": pub("全員に二段階認証を求めるか"),
  "organizations.tenants.created_at": internal("作った時刻"),

  "organizations.users.id": internal("人の ID(ログ・監査ログで誰かを指す)"),
  "organizations.users.tenant_id": internal("所属する組織"),
  "organizations.users.email": personal("ログインとお知らせの宛先"),
  "organizations.users.external_id": internal("Cognito の利用者 ID(sub)。ログインと結びつける"),
  "organizations.users.name": personal("画面に出す名前"),
  "organizations.users.role": pub("ロール(admin / member / viewer)"),
  "organizations.users.mfa_enabled": pub("二段階認証が有効か"),
  "organizations.users.sessions_valid_after": internal("これより前のセッションを切る"),
  "organizations.users.created_at": internal("作った時刻"),

  "organizations.support_grants.id": internal("許可の ID"),
  "organizations.support_grants.tenant_id": internal("許可を出した組織"),
  "organizations.support_grants.granted_by": internal("許可を出した人の ID"),
  "organizations.support_grants.code_hash": internal(
    "サポート番号の SHA-256 で許可を探す(番号は持たない)",
  ),
  "organizations.support_grants.created_at": internal("出した時刻"),
  "organizations.support_grants.expires_at": internal("期限"),
  "organizations.support_grants.revoked_at": internal("取り消した時刻"),
  "organizations.support_grants.revoked_by": internal("取り消した人の ID"),

  "organizations.support_sessions.id": internal("入室の ID"),
  "organizations.support_sessions.tenant_id": internal("入った組織"),
  "organizations.support_sessions.grant_id": internal("使った許可"),
  "organizations.support_sessions.staff_user_id": internal("入った社員の ID"),
  "organizations.support_sessions.staff_name": personal("お客さんの画面に「誰が入ったか」を出す"),
  "organizations.support_sessions.staff_email": personal("入った社員の連絡先を画面に出す"),
  "organizations.support_sessions.started_at": internal("入った時刻"),
  "organizations.support_sessions.expires_at": internal("期限"),
  "organizations.support_sessions.ended_at": internal("終えた時刻"),

  "organizations.email_changes.id": internal("申し込みの ID"),
  "organizations.email_changes.tenant_id": internal("組織"),
  "organizations.email_changes.user_id": internal("申し込んだ人の ID"),
  "organizations.email_changes.previous_email": personal("変わったお知らせを古いアドレスへ送る"),
  "organizations.email_changes.new_email": personal("確認コードを新しいアドレスへ送る"),
  "organizations.email_changes.requested_at": internal("申し込んだ時刻(24時間の期限)"),
  "organizations.email_changes.confirmed_at": internal("変わった時刻"),

  // ── プロジェクト(projects) ──
  "projects.projects.id": internal("プロジェクトの ID"),
  "projects.projects.tenant_id": internal("組織"),
  "projects.projects.name": personal("お客さんが入れた名前(自由な文なので個人情報が入りうる)"),
  "projects.projects.created_by": internal("作った人の ID"),
  "projects.projects.created_at": internal("作った時刻(一覧の並び)"),

  // ── タスク(tasks) ──
  "tasks.tasks.id": internal("タスクの ID"),
  "tasks.tasks.tenant_id": internal("組織"),
  "tasks.tasks.project_id": internal("属するプロジェクト"),
  "tasks.tasks.title": personal("お客さんが入れた題名(自由な文なので個人情報が入りうる)"),
  "tasks.tasks.done": pub("完了したか"),
  "tasks.tasks.created_at": internal("作った時刻(一覧の並び)"),
  "tasks.tasks.updated_at": internal("直した時刻"),

  // ── 共通の仕組み(platform) ──
  "platform.audit_events.id": internal("記録の ID(時刻の順)"),
  "platform.audit_events.tenant_id": internal("組織"),
  "platform.audit_events.occurred_at": internal("起きた時刻"),
  "platform.audit_events.actor_kind": pub("誰の種類(user / support / system)"),
  "platform.audit_events.actor_id": internal("した人の ID"),
  "platform.audit_events.action": pub("何をしたか(対象.動作)"),
  "platform.audit_events.target_type": pub("対象の種類"),
  "platform.audit_events.target_id": internal("対象の ID"),
  "platform.audit_events.outcome": pub("できた / 断った"),
  "platform.audit_events.request_id": internal("アプリのログと突き合わせる"),
  "platform.audit_events.details": {
    ...internal("ほかのパスの ID・直した項目の名前(値は入れない。ADR 0013)"),
    keys: {
      // パスの ID(対象の ID 以外)。API のパスに ID を足したら、ここにも足す(テストが落ちる)
      projectId: internal("タスクを作ったプロジェクトなど"),
      taskId: internal("パスのタスクの ID"),
      grantId: internal("パスの許可の ID"),
      fields: internal("直した項目の名前の一覧(値は入れない)"),
      route: internal("代理の社員が呼んだ API の形(メソッドとパスの型)"),
      counts: internal("解約で消した表ごとの行数"),
    },
  },

  "platform.outbox.id": internal("出来事の ID"),
  "platform.outbox.tenant_id": internal("組織"),
  "platform.outbox.topic": pub("何が起きたか(領域.出来事)"),
  "platform.outbox.payload": {
    ...internal("出来事の中身(何を指すかの ID だけ。ADR 0006)"),
    keys: {
      // 出来事の中身のキー(src/outbox/topics.ts)。足したら、ここにも足す(テストが落ちる)
      taskId: internal("完了したタスク"),
      projectId: internal("そのプロジェクト"),
      completedBy: internal("完了にした人の ID"),
      userId: internal("お知らせを送る相手の ID(宛先は送る直前に DB から読む)"),
      emailChangeId: internal("メールアドレスの変更の ID(古いアドレスは表から読む)"),
    },
  },
  "platform.outbox.created_at": internal("積んだ時刻"),
  "platform.outbox.available_at": internal("送ってよい時刻"),
  "platform.outbox.locked_until": internal("送り出しが借りている期限"),
  "platform.outbox.attempts": internal("試した回数"),
  "platform.outbox.sent_at": internal("送れた時刻"),
  "platform.outbox.dead_at": internal("あきらめた時刻"),
  "platform.outbox.last_error": personal(
    "最後の失敗の文(人が見て直す)。生の文なので宛先などの値が入りうる",
  ),
};
