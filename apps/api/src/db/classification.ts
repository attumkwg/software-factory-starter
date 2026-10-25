// 列の分類表(個人情報の台帳の元。docs/specs/0008-personal-data.md・ADR 0018)。
// DB の全部の列に、区分と利用目的の一言を書く。列を足したら、ここにも1行足す
// (無ければ test/unit/classification.test.ts が落ちる)。区分を変える・sensitive を足すのは人の確認が要る(危険度「高」)。
//
// 区分:
//   public    … 決まった選択肢・真偽(ロールの種類・状態・時間帯)。誰の物かを除けば意味が無い
//   internal  … 仕組みの値(ID・ハッシュ・時刻・回数)。ID は単体では人が分からない。ログに出してよい
//   personal  … 個人情報か、お客さんが入れた自由な文(名前・メールアドレス・題名)。ログ・監査ログ・送信待ち・Sentry に出さない
//   sensitive … 要配慮個人情報(病歴・障害・信条・犯罪の経歴など。個人情報保護法 2条3項)。
//               スキーマ sensitive の表にだけ置ける(分ける段は ADR 0018、段1の作りは ADR 0029)。
//               読み書きは src/sensitive/ からだけ・値は暗号化してから書く・ログ・監査ログ・AI に渡さない
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

  "organizations.invitations.id": internal("招待の ID(リンクの署名の元)"),
  "organizations.invitations.tenant_id": internal("招いた組織"),
  "organizations.invitations.email": personal(
    "招いた人のメールアドレス(招待のメールの宛先・受けたら users の行になる)",
  ),
  "organizations.invitations.role": pub("招いたロール"),
  "organizations.invitations.invited_by": internal("招いた管理者"),
  "organizations.invitations.created_at": internal("招いた時刻"),
  "organizations.invitations.expires_at": internal("リンクの期限"),
  "organizations.invitations.accepted_at": internal("受けた時刻(1回きり)"),
  "organizations.invitations.accepted_user_id": internal("受けてできた人の ID"),
  "organizations.invitations.revoked_at": internal("取り消した時刻"),
  "organizations.invitations.revoked_by": internal("取り消した管理者"),

  // 会社のドメインと IP の範囲(docs/specs/0056-sso-scim-ip-audit-export.md)。お客さんの会社の設定で、人の情報ではない
  "organizations.domains.id": internal("ドメインの行の ID"),
  "organizations.domains.tenant_id": internal("登録した組織"),
  "organizations.domains.domain": internal("会社のドメイン(SSO で、どの組織の人かを決める)"),
  "organizations.domains.verify_token": internal(
    "DNS の TXT に置く確かめの文字(公開の DNS に出る。秘密ではない)",
  ),
  "organizations.domains.verified_at": internal("DNS で確かめた時刻(全体で1つの組織だけ)"),
  "organizations.domains.created_at": internal("登録した時刻"),
  "organizations.domains.created_by": internal("登録した管理者"),
  "organizations.ip_allowlist.id": internal("範囲の行の ID"),
  "organizations.ip_allowlist.tenant_id": internal("範囲を決めた組織"),
  "organizations.ip_allowlist.cidr": internal("組織に入れる IP の範囲(会社のネットワーク)"),
  "organizations.ip_allowlist.created_at": internal("足した時刻"),
  "organizations.ip_allowlist.created_by": internal("足した管理者"),

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

  // ── 規約と同意(legal。docs/specs/0009-legal-consent.md) ──
  "legal.consents.id": internal("同意の記録の ID"),
  "legal.consents.tenant_id": internal("組織"),
  "legal.consents.user_id": internal("同意した人の ID"),
  "legal.consents.document": pub("どの文書か(terms / privacy)"),
  "legal.consents.version": internal("同意した版(施行日の数字)"),
  "legal.consents.capacity": pub("組織としてか本人としてか(organization / individual)"),
  "legal.consents.source": pub("どの画面で同意したか(sign_up / acceptance)"),
  "legal.consents.accepted_at": internal("同意した時刻(同意の証拠)"),

  "legal.notices.id": internal("お知らせの ID(送信待ちの出来事が指す)"),
  "legal.notices.tenant_id": internal("組織"),
  "legal.notices.user_id": internal("お知らせを送る相手の ID(宛先は送る直前に DB から読む)"),
  "legal.notices.document": pub("どの文書の変更か(terms / privacy)"),
  "legal.notices.version": internal("知らせた版(施行日の数字)"),
  "legal.notices.created_at": internal("送ると決めた時刻(周知の証拠)"),

  // ── 集客(growth。公開の LP の事前登録と日ごとの数。docs/specs/0025-public-landing-page.md)。運営の組織の持ち物 ──
  "growth.pre_registrations.id": internal("事前登録の ID(組織を作るコマンドに渡す)"),
  "growth.pre_registrations.tenant_id": internal("運営の組織"),
  "growth.pre_registrations.email": personal(
    "確認のメール・提供開始の案内・試しの利用の招待・組織を作るときの最初の管理者",
  ),
  "growth.pre_registrations.organization_name": personal(
    "組織を作るときの名前の案(個人事業なら人の名前になる)",
  ),
  "growth.pre_registrations.company_size": pub("会社の規模の幅(集計)"),
  "growth.pre_registrations.utm_source": internal("どこから来たか(UTM。英数と -_. だけ)"),
  "growth.pre_registrations.utm_medium": internal("どこから来たか(UTM)"),
  "growth.pre_registrations.utm_campaign": internal("どこから来たか(UTM)"),
  "growth.pre_registrations.landing_path": pub("どのページで登録したか(クエリを落とした path)"),
  "growth.pre_registrations.consent_text_version": internal("同意した文の版(同意の証拠)"),
  "growth.pre_registrations.privacy_version": internal(
    "そのときのプライバシーポリシーの版(同意の証拠)",
  ),
  "growth.pre_registrations.consented_at": internal("同意して送った時刻(同意の証拠)"),
  "growth.pre_registrations.confirm_sent_at": internal(
    "確認のメールを積んだ時刻(24時間に1通・リンクの署名)",
  ),
  "growth.pre_registrations.confirmed_at": internal("確認のリンクを開いた時刻(本人の確認の証拠)"),
  "growth.pre_registrations.status": pub("状態(pending / confirmed / converted)"),
  "growth.pre_registrations.converted_tenant_id": internal("組織にしたら、その組織の ID"),
  "growth.pre_registrations.converted_at": internal("組織にした時刻"),
  "growth.pre_registrations.delete_after": internal("この日を過ぎたら消す(保存期間)"),
  "growth.pre_registrations.created_at": internal("登録した時刻"),
  "growth.lp_daily_counts.tenant_id": internal("運営の組織"),
  "growth.lp_daily_counts.day": internal("日(日本時間)"),
  "growth.lp_daily_counts.path": pub("ページの path"),
  "growth.lp_daily_counts.utm_source": internal("どこから来たか(UTM)"),
  "growth.lp_daily_counts.utm_medium": internal("どこから来たか(UTM)"),
  "growth.lp_daily_counts.utm_campaign": internal("どこから来たか(UTM)"),
  "growth.lp_daily_counts.views": internal("見た数"),
  "growth.lp_daily_counts.registrations": internal("登録の数"),
  "growth.lp_daily_counts.confirmations": internal("確認の数"),

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
      invitationId: internal("パスの招待の ID"),
      domainId: internal("パスの会社のドメインの ID"),
      memberId: internal("パスの強制ログアウトした人の ID"),
      fields: internal("直した項目の名前の一覧(値は入れない)"),
      route: internal("代理の社員が呼んだ API の形(メソッドとパスの型)"),
      counts: internal("解約で消した表ごとの行数"),
      flag: internal("運営が入れた・切った機能の名前(FEATURE_FLAGS の name)"),
      adminUserId: internal("運営が組織を作ったときの、最初の管理者の ID"),
      plan: internal("運営が変えたプランの名前(PLANS の id)"),
      priceList: internal("運営が変えたプランの価格表の版(PRICE_LISTS の id)"),
      preRegistrations: internal("期限で消した事前登録の数"),
      dailyCounts: internal("期限で消した日ごとの数の行の数"),
      convertedTenantId: internal("事前登録から作った組織の ID"),
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
      noticeId: internal("規約の変更のお知らせの ID(宛先と版は表から読む)"),
      invitationId: internal("招待の ID(宛先と組織は表から読む。リンクは送る直前に作る)"),
      preRegistrationId: internal("事前登録の ID(宛先とリンクは表から読む)"),
    },
  },
  "platform.outbox.created_at": internal("積んだ時刻"),
  "platform.outbox.available_at": internal("送ってよい時刻"),
  "platform.outbox.locked_until": internal("送り出しが借りている期限"),
  "platform.outbox.attempts": internal("試した回数"),
  "platform.outbox.sent_at": internal("送れた時刻"),
  "platform.outbox.dead_at": internal("あきらめた時刻"),
  "platform.outbox.last_error": internal(
    "最後の失敗の種類と文(人が見て直す)。値は伏せてから書く(relay.ts の scrubMessage)",
  ),

  // ── 機能フラグ(docs/specs/0012-feature-flags-and-usage.md) ──
  "platform.feature_flags.id": internal("行の ID"),
  "platform.feature_flags.tenant_id": internal("機能を入れた組織"),
  "platform.feature_flags.flag": pub("入れた機能の名前(@app/shared の FEATURE_FLAGS)"),
  "platform.feature_flags.enabled_at": internal("入れた時刻(いつから出ていたか)"),

  // ── 契約のプラン(docs/specs/0047-plans.md)。足すだけ。書くのは運営のコマンドだけ ──
  "platform.tenant_plans.id": internal("行の ID"),
  "platform.tenant_plans.tenant_id": internal("契約した組織"),
  "platform.tenant_plans.plan": pub("プランの名前(@app/shared の PLANS)"),
  "platform.tenant_plans.price_list": pub(
    "どの版の価格表で契約しているか(@app/shared の PRICE_LISTS。金額は持たない)",
  ),
  "platform.tenant_plans.seats": internal("人数の上限(null は上限なし)"),
  "platform.tenant_plans.price_locked_until": internal("据え置き(旧価格のまま)の期限"),
  "platform.tenant_plans.effective_on": internal("この契約がいつからか(組織の時間帯の日付)"),
  "platform.tenant_plans.created_at": internal("足した時刻"),

  // ── 利用の記録(docs/specs/0012-feature-flags-and-usage.md)。1日1人1機能1行。保存期間(USAGE_RETENTION_DAYS)で消す ──
  "platform.feature_usage.id": internal("行の ID"),
  "platform.feature_usage.tenant_id": internal("使った組織"),
  "platform.feature_usage.user_id": internal(
    "使った人の ID(賭けの線: 組織の中で何人が使い続けるか)",
  ),
  "platform.feature_usage.feature": pub("使った機能の名前(FEATURE_FLAGS の name)"),
  "platform.feature_usage.day": internal("使った日(組織の時間帯。時刻は持たない)"),

  // ── 「無くなったら困るか」(docs/specs/0046-pmf-survey.md)。だれが何と答えたかを結びつけないよう、印と数を分ける ──
  "platform.pmf_survey_asked.id": internal("行の ID"),
  "platform.pmf_survey_asked.tenant_id": internal("答えた人の組織"),
  "platform.pmf_survey_asked.user_id": internal(
    "この回に答え終えた人の ID(1人1回・四半期に1回にするため。答えは持たない)",
  ),
  "platform.pmf_survey_asked.round": pub("聞いた回(「2026-Q4」の形)"),
  "platform.pmf_survey_asked.day": internal(
    "答えた日(組織の時間帯。時刻は持たない。保存期間で消す)",
  ),
  "platform.pmf_survey_counts.id": internal("行の ID"),
  "platform.pmf_survey_counts.tenant_id": internal("答えた人の組織"),
  "platform.pmf_survey_counts.round": pub("聞いた回"),
  "platform.pmf_survey_counts.answer": pub("答えの種類(@app/shared の PMF_SURVEY_ANSWERS)"),
  "platform.pmf_survey_counts.count": internal("その答えの数(人は持たない)"),

  // ── 要配慮個人情報(sensitive。ADR 0018・0029)。読み書きは src/sensitive/ からだけ・接続は app_sensitive ──
  // 要配慮の列は、ここに sensitive で足し、値は src/sensitive/ の seal() で暗号化してから書く(DB には暗号文だけ)
  "sensitive.tenant_keys.tenant_id": internal("データ鍵の持ち主の組織"),
  "sensitive.tenant_keys.kms_key_id": internal("データ鍵を包んだ KMS の鍵(ARN)"),
  "sensitive.tenant_keys.wrapped_key": internal(
    "KMS で包んだデータ鍵(KMS が無ければ開けない。消すと、その組織の要配慮の暗号文が読めなくなる)",
  ),
  "sensitive.tenant_keys.created_at": internal("作った時刻"),
};
