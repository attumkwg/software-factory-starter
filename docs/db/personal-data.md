# 個人情報の台帳

> **作ったファイル。手で直さない。** 元は `apps/api/src/db/classification.ts`(列の分類表)。`pnpm docs:personal-data` で作り直す。
> 区分の意味と決まりは分類表の先頭・[docs/specs/0008-personal-data.md](../specs/0008-personal-data.md)・[ADR 0018](../adr/0018-sensitive-data-isolation.md)。
> 要配慮個人情報(sensitive)は、スキーマ `sensitive` の表にだけ置ける。

## 個人情報を持つ列(personal / sensitive)

プライバシーポリシーの「取得する情報と利用目的」・利用者からの開示や削除の依頼・漏えいのときの影響の範囲は、この表から答える。

| 表 | 列 | 区分 | 利用目的 |
|---|---|---|---|
| `growth.pre_registrations` | `email` | **personal** | 確認のメール・提供開始の案内・試しの利用の招待・組織を作るときの最初の管理者 |
| `growth.pre_registrations` | `organization_name` | **personal** | 組織を作るときの名前の案(個人事業なら人の名前になる) |
| `organizations.email_changes` | `previous_email` | **personal** | 変わったお知らせを古いアドレスへ送る |
| `organizations.email_changes` | `new_email` | **personal** | 確認コードを新しいアドレスへ送る |
| `organizations.invitations` | `email` | **personal** | 招いた人のメールアドレス(招待のメールの宛先・受けたら users の行になる) |
| `organizations.support_sessions` | `staff_name` | **personal** | お客さんの画面に「誰が入ったか」を出す |
| `organizations.support_sessions` | `staff_email` | **personal** | 入った社員の連絡先を画面に出す |
| `organizations.tenants` | `name` | **personal** | 組織の名前を画面に出す(個人事業主なら人の名前になる) |
| `organizations.users` | `email` | **personal** | ログインとお知らせの宛先 |
| `organizations.users` | `name` | **personal** | 画面に出す名前 |
| `projects.projects` | `name` | **personal** | お客さんが入れた名前(自由な文なので個人情報が入りうる) |
| `tasks.tasks` | `title` | **personal** | お客さんが入れた題名(自由な文なので個人情報が入りうる) |

## 全部の列

### `growth.lp_daily_counts`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `tenant_id` | internal | 運営の組織 |
| `day` | internal | 日(日本時間) |
| `path` | public | ページの path |
| `utm_source` | internal | どこから来たか(UTM) |
| `utm_medium` | internal | どこから来たか(UTM) |
| `utm_campaign` | internal | どこから来たか(UTM) |
| `views` | internal | 見た数 |
| `registrations` | internal | 登録の数 |
| `confirmations` | internal | 確認の数 |

### `growth.pre_registrations`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 事前登録の ID(組織を作るコマンドに渡す) |
| `tenant_id` | internal | 運営の組織 |
| `email` | **personal** | 確認のメール・提供開始の案内・試しの利用の招待・組織を作るときの最初の管理者 |
| `organization_name` | **personal** | 組織を作るときの名前の案(個人事業なら人の名前になる) |
| `company_size` | public | 会社の規模の幅(集計) |
| `utm_source` | internal | どこから来たか(UTM。英数と -_. だけ) |
| `utm_medium` | internal | どこから来たか(UTM) |
| `utm_campaign` | internal | どこから来たか(UTM) |
| `landing_path` | public | どのページで登録したか(クエリを落とした path) |
| `consent_text_version` | internal | 同意した文の版(同意の証拠) |
| `privacy_version` | internal | そのときのプライバシーポリシーの版(同意の証拠) |
| `consented_at` | internal | 同意して送った時刻(同意の証拠) |
| `confirm_sent_at` | internal | 確認のメールを積んだ時刻(24時間に1通・リンクの署名) |
| `confirmed_at` | internal | 確認のリンクを開いた時刻(本人の確認の証拠) |
| `status` | public | 状態(pending / confirmed / converted) |
| `converted_tenant_id` | internal | 組織にしたら、その組織の ID |
| `converted_at` | internal | 組織にした時刻 |
| `delete_after` | internal | この日を過ぎたら消す(保存期間) |
| `created_at` | internal | 登録した時刻 |

### `legal.consents`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 同意の記録の ID |
| `tenant_id` | internal | 組織 |
| `user_id` | internal | 同意した人の ID |
| `document` | public | どの文書か(terms / privacy) |
| `version` | internal | 同意した版(施行日の数字) |
| `capacity` | public | 組織としてか本人としてか(organization / individual) |
| `source` | public | どの画面で同意したか(sign_up / acceptance) |
| `accepted_at` | internal | 同意した時刻(同意の証拠) |

### `legal.notices`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | お知らせの ID(送信待ちの出来事が指す) |
| `tenant_id` | internal | 組織 |
| `user_id` | internal | お知らせを送る相手の ID(宛先は送る直前に DB から読む) |
| `document` | public | どの文書の変更か(terms / privacy) |
| `version` | internal | 知らせた版(施行日の数字) |
| `created_at` | internal | 送ると決めた時刻(周知の証拠) |

### `organizations.email_changes`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 申し込みの ID |
| `tenant_id` | internal | 組織 |
| `user_id` | internal | 申し込んだ人の ID |
| `previous_email` | **personal** | 変わったお知らせを古いアドレスへ送る |
| `new_email` | **personal** | 確認コードを新しいアドレスへ送る |
| `requested_at` | internal | 申し込んだ時刻(24時間の期限) |
| `confirmed_at` | internal | 変わった時刻 |

### `organizations.invitations`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 招待の ID(リンクの署名の元) |
| `tenant_id` | internal | 招いた組織 |
| `email` | **personal** | 招いた人のメールアドレス(招待のメールの宛先・受けたら users の行になる) |
| `role` | public | 招いたロール |
| `invited_by` | internal | 招いた管理者 |
| `created_at` | internal | 招いた時刻 |
| `expires_at` | internal | リンクの期限 |
| `accepted_at` | internal | 受けた時刻(1回きり) |
| `accepted_user_id` | internal | 受けてできた人の ID |
| `revoked_at` | internal | 取り消した時刻 |
| `revoked_by` | internal | 取り消した管理者 |

### `organizations.support_grants`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 許可の ID |
| `tenant_id` | internal | 許可を出した組織 |
| `granted_by` | internal | 許可を出した人の ID |
| `code_hash` | internal | サポート番号の SHA-256 で許可を探す(番号は持たない) |
| `created_at` | internal | 出した時刻 |
| `expires_at` | internal | 期限 |
| `revoked_at` | internal | 取り消した時刻 |
| `revoked_by` | internal | 取り消した人の ID |

### `organizations.support_sessions`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 入室の ID |
| `tenant_id` | internal | 入った組織 |
| `grant_id` | internal | 使った許可 |
| `staff_user_id` | internal | 入った社員の ID |
| `staff_name` | **personal** | お客さんの画面に「誰が入ったか」を出す |
| `staff_email` | **personal** | 入った社員の連絡先を画面に出す |
| `started_at` | internal | 入った時刻 |
| `expires_at` | internal | 期限 |
| `ended_at` | internal | 終えた時刻 |

### `organizations.tenants`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `tenant_id` | internal | 組織の ID |
| `name` | **personal** | 組織の名前を画面に出す(個人事業主なら人の名前になる) |
| `time_zone` | public | 時刻を見せる時間帯・「1日」の区切り |
| `mfa_required` | public | 全員に二段階認証を求めるか |
| `created_at` | internal | 作った時刻 |

### `organizations.users`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 人の ID(ログ・監査ログで誰かを指す) |
| `tenant_id` | internal | 所属する組織 |
| `email` | **personal** | ログインとお知らせの宛先 |
| `external_id` | internal | Cognito の利用者 ID(sub)。ログインと結びつける |
| `name` | **personal** | 画面に出す名前 |
| `role` | public | ロール(admin / member / viewer) |
| `mfa_enabled` | public | 二段階認証が有効か |
| `sessions_valid_after` | internal | これより前のセッションを切る |
| `created_at` | internal | 作った時刻 |

### `platform.audit_events`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 記録の ID(時刻の順) |
| `tenant_id` | internal | 組織 |
| `occurred_at` | internal | 起きた時刻 |
| `actor_kind` | public | 誰の種類(user / support / system) |
| `actor_id` | internal | した人の ID |
| `action` | public | 何をしたか(対象.動作) |
| `target_type` | public | 対象の種類 |
| `target_id` | internal | 対象の ID |
| `outcome` | public | できた / 断った |
| `request_id` | internal | アプリのログと突き合わせる |
| `details` | internal | ほかのパスの ID・直した項目の名前(値は入れない。ADR 0013) |
| `details` の `projectId` | internal | タスクを作ったプロジェクトなど |
| `details` の `taskId` | internal | パスのタスクの ID |
| `details` の `grantId` | internal | パスの許可の ID |
| `details` の `invitationId` | internal | パスの招待の ID |
| `details` の `fields` | internal | 直した項目の名前の一覧(値は入れない) |
| `details` の `route` | internal | 代理の社員が呼んだ API の形(メソッドとパスの型) |
| `details` の `counts` | internal | 解約で消した表ごとの行数 |
| `details` の `flag` | internal | 運営が入れた・切った機能の名前(FEATURE_FLAGS の name) |
| `details` の `adminUserId` | internal | 運営が組織を作ったときの、最初の管理者の ID |
| `details` の `plan` | internal | 運営が変えたプランの名前(PLANS の id) |
| `details` の `priceList` | internal | 運営が変えたプランの価格表の版(PRICE_LISTS の id) |
| `details` の `preRegistrations` | internal | 期限で消した事前登録の数 |
| `details` の `dailyCounts` | internal | 期限で消した日ごとの数の行の数 |
| `details` の `convertedTenantId` | internal | 事前登録から作った組織の ID |

### `platform.feature_flags`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 行の ID |
| `tenant_id` | internal | 機能を入れた組織 |
| `flag` | public | 入れた機能の名前(@app/shared の FEATURE_FLAGS) |
| `enabled_at` | internal | 入れた時刻(いつから出ていたか) |

### `platform.feature_usage`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 行の ID |
| `tenant_id` | internal | 使った組織 |
| `user_id` | internal | 使った人の ID(賭けの線: 組織の中で何人が使い続けるか) |
| `feature` | public | 使った機能の名前(FEATURE_FLAGS の name) |
| `day` | internal | 使った日(組織の時間帯。時刻は持たない) |

### `platform.outbox`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 出来事の ID |
| `tenant_id` | internal | 組織 |
| `topic` | public | 何が起きたか(領域.出来事) |
| `payload` | internal | 出来事の中身(何を指すかの ID だけ。ADR 0006) |
| `payload` の `taskId` | internal | 完了したタスク |
| `payload` の `projectId` | internal | そのプロジェクト |
| `payload` の `completedBy` | internal | 完了にした人の ID |
| `payload` の `userId` | internal | お知らせを送る相手の ID(宛先は送る直前に DB から読む) |
| `payload` の `emailChangeId` | internal | メールアドレスの変更の ID(古いアドレスは表から読む) |
| `payload` の `noticeId` | internal | 規約の変更のお知らせの ID(宛先と版は表から読む) |
| `payload` の `invitationId` | internal | 招待の ID(宛先と組織は表から読む。リンクは送る直前に作る) |
| `payload` の `preRegistrationId` | internal | 事前登録の ID(宛先とリンクは表から読む) |
| `created_at` | internal | 積んだ時刻 |
| `available_at` | internal | 送ってよい時刻 |
| `locked_until` | internal | 送り出しが借りている期限 |
| `attempts` | internal | 試した回数 |
| `sent_at` | internal | 送れた時刻 |
| `dead_at` | internal | あきらめた時刻 |
| `last_error` | internal | 最後の失敗の種類と文(人が見て直す)。値は伏せてから書く(relay.ts の scrubMessage) |

### `platform.tenant_plans`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | 行の ID |
| `tenant_id` | internal | 契約した組織 |
| `plan` | public | プランの名前(@app/shared の PLANS) |
| `price_list` | public | どの版の価格表で契約しているか(@app/shared の PRICE_LISTS。金額は持たない) |
| `seats` | internal | 人数の上限(null は上限なし) |
| `price_locked_until` | internal | 据え置き(旧価格のまま)の期限 |
| `effective_on` | internal | この契約がいつからか(組織の時間帯の日付) |
| `created_at` | internal | 足した時刻 |

### `projects.projects`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | プロジェクトの ID |
| `tenant_id` | internal | 組織 |
| `name` | **personal** | お客さんが入れた名前(自由な文なので個人情報が入りうる) |
| `created_by` | internal | 作った人の ID |
| `created_at` | internal | 作った時刻(一覧の並び) |

### `sensitive.tenant_keys`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `tenant_id` | internal | データ鍵の持ち主の組織 |
| `kms_key_id` | internal | データ鍵を包んだ KMS の鍵(ARN) |
| `wrapped_key` | internal | KMS で包んだデータ鍵(KMS が無ければ開けない。消すと、その組織の要配慮の暗号文が読めなくなる) |
| `created_at` | internal | 作った時刻 |

### `tasks.tasks`

| 列 | 区分 | 利用目的 |
|---|---|---|
| `id` | internal | タスクの ID |
| `tenant_id` | internal | 組織 |
| `project_id` | internal | 属するプロジェクト |
| `title` | **personal** | お客さんが入れた題名(自由な文なので個人情報が入りうる) |
| `done` | public | 完了したか |
| `created_at` | internal | 作った時刻(一覧の並び) |
| `updated_at` | internal | 直した時刻 |
