# 国のサプライチェーンのセキュリティ評価制度(SCS 評価制度・★3・★4)との対応表

> **何か**: 経済産業省が方針を出し、IPA が運営する「サプライチェーン強化に向けたセキュリティ対策評価制度」の要求事項(★3・★4)と、このキットの管理策([controls.yaml](controls.yaml) の附属書 A の番号)・仕組み・手順の対応。取引先から「★3 は取れますか」と聞かれたとき・質問票(`/security-questionnaire`)の材料。
> **これは準備の表で、評価の結果ではない**。★3 は専門家の確認つきの自己評価、★4 は評価機関による第三者評価で決まる。キットの仕組みがあっても、使う人の会社の規程・端末・体制がそろわなければ当たらない(下の「扱い」)。
> **確かめた日と出どころ**: 2026-10-25 に、公的な一次資料(経済産業省「サプライチェーン強化に向けたセキュリティ対策評価制度に関する制度構築方針」2026年3月27日・IPA の制度のページと「★3・★4 要求事項・評価基準」)で確かめた。要求事項は43件(★3 は 26件・★4 は全43件)。評価基準(細目)と、2026年秋ごろ公表予定の解説書・評価ガイドは、ここに写していない(一次資料で確かめる)。
> **開始の後に見直す**: 運用の開始は 2026年度下期の見込み(評価用のガイドの公表の後)。点検の台帳の `scs-review` が半年ごとに、公表物が出たか・取引先に求められたかを聞く。設計書 [0052](../designs/0052-scs-mapping.md)。
>
> 出どころ(公的な一次資料):
> - IPA「SCS評価制度の詳細情報」 https://www.ipa.go.jp/security/scs/details.html
> - IPA「要求事項・評価基準」 https://www.ipa.go.jp/security/scs/requirements-criteria.html
> - 経済産業省「サプライチェーン強化に向けたセキュリティ対策評価制度(SCS評価制度)」 https://www.meti.go.jp/policy/netsecurity/scs.html

## 扱いの見方

| 印 | 意味 |
|---|---|
| ◎ | キットに仕組みか手順がある(使う人の本番で有効にしてあれば、根拠に使える) |
| ○ | キットは仕組みや型を持つ。使う人が規程・体制・名前を埋める |
| △ | キットの外(社内の端末・事務所・人事)。使う人が整える |
| 委 | 委託先(AWS など)の守りに頼る。委託先の第三者の認証で示す([vendors.md](vendors.md)) |

## 対応表

| No. | ★3 | ★4 | 要求事項名(要旨) | 管理策 | 扱い | このキットのどこ | 使う人がやること |
|---|---|---|---|---|---|---|---|
| 1-1-1 | | ○ | 社内ルール(法令などを考えて作り、知らせる) | A.5.31・A.5.1 | ○ | 規程のひな形 [policies/](policies/README.md)・法令の洗い出し `docs/product/legal.md`・点検 `law-review` | 規程を自社の物にする(点検 `policies-adopt`) |
| 1-2-1 | ○ | ○ | セキュリティを進める部門・役割 | A.5.2 | ○ | [基本方針](policies/basic-policy.md) の役割の表・点検の担当者 | 責任者の名前を入れ、年1回見直す(`management-review`) |
| 1-2-2 | | ○ | 攻撃と予兆を見張り・分析する体制 | A.8.16・A.5.7 | ○ | [guides/monitoring.md](../guides/monitoring.md)・`modules/security-baseline`(GuardDuty・Security Hub)・[guides/on-call.md](../guides/on-call.md) | 見る人と当番を決める(点検 `oncall-rota`) |
| 1-2-3 | ○ | ○ | 守秘義務のルール | A.6.6 | ○ | 基本方針の 8(誓約)・[runbooks/joiner-leaver.md](../runbooks/joiner-leaver.md) | 誓約書を交わす(雇う・頼む契約) |
| 1-3-1 | ○ | ○ | セキュリティの対応方針 | A.5.1 | ○ | [基本方針](policies/basic-policy.md)・[security.md](../security.md) | 経営者が承認して全員に知らせる |
| 1-4-1 | | ○ | 推進の計画と経営層への報告 | A.5.4・A.5.35 | ○ | [マネジメントレビュー](policies/management-review.md)・点検の台帳(毎週の知らせ) | 年1回のレビューを開く |
| 2-1-1 | ○ | ○ | 取引先との関係の把握 | A.5.19 | ◎ | 委託先の台帳 [vendors.yaml](vendors.yaml)(CI で照らす) | お客さん(取引先)の側は契約の管理の置き場で |
| 2-1-2 | ○ | ○ | 機密情報の扱いを共有先と明確に | A.5.14・A.5.20 | ○ | [legal/data-processing.md](../legal/data-processing.md)・[ai-data.md](ai-data.md) | 取り決めの文面を専門家と作る |
| 2-1-3 | | ○ | 取引先のセキュリティ状況の把握 | A.5.19・A.5.22 | ◎ | 台帳の第三者の認証と確かめた日・点検 `vendor-review` | 年1回見直す |
| 2-1-4 | ○ | ○ | 事故のときの他社との役割と責任 | A.5.20・A.5.24 | ○ | [legal/data-processing.md](../legal/data-processing.md) の 3・[legal/sla.md](../legal/sla.md)・[runbooks/personal-data-breach.md](../runbooks/personal-data-breach.md) の 4 | 取り決めに書く |
| 2-1-5 | | ○ | 契約が終わったときの回収・破棄 | A.5.20・A.5.11 | ◎ | 台帳の `deletion`・[runbooks/offboarding.md](../runbooks/offboarding.md)・[legal/data-processing.md](../legal/data-processing.md) の 5 | 委託先をやめたときに台帳を `ended` に |
| 3-1-1 | ○ | ○ | 機器・OS・ソフトウェアの把握 | A.5.9 | ○ | Terraform(本番の目録)・依存の版(lockfile と Trivy)・点検 `eol` | 社員の端末の一覧(△) |
| 3-1-2 | ○ | ○ | ネットワークの把握 | A.8.20 | ◎ | `infra/terraform/modules/network`(VPC・サブネット・流れのログ) | 事務所のネットワークがあれば(△) |
| 3-1-3 | ○ | ○ | 機密情報を扱う外部のサービスの管理 | A.5.23 | ◎ | 委託先の台帳・[policies/vendors.md](policies/vendors.md) | — |
| 3-1-4 | ○ | ○ | 機密区分に応じた情報の管理 | A.5.12・A.5.13 | ◎ | 列の分類表 `apps/api/src/db/classification.ts`・[db/personal-data.md](../db/personal-data.md)・要配慮の分離(ADR 0018) | 社内の文書の区分(△) |
| 3-1-5 | | ○ | リモートワークのルール | A.6.7 | △ | — | 規程に足す(端末・置いてよい情報) |
| 3-2-1 | | ○ | 脆弱性の管理体制 | A.8.8 | ◎ | [guides/vulnerabilities.md](../guides/vulnerabilities.md)・`/cve`・点検 `w-vuln` | 担当を決める |
| 4-1-1 | ○ | ○ | 利用者の ID の発行・変更・削除 | A.5.16・A.5.18 | ◎ | [runbooks/joiner-leaver.md](../runbooks/joiner-leaver.md)・点検 `people-changes`・`access-review` | 社内の道具を手順書の 0 に足す |
| 4-1-2 | ○ | ○ | 管理者の ID の発行・変更・削除 | A.8.2 | ◎ | 同上・点検 `acct-two-admins` | — |
| 4-1-3 | ○ | ○ | 認証の強さと実装 | A.8.5 | ◎ | 社員は二段階認証(点検 `acct-mfa`)・アプリは二段階認証と組織の必須([specs/0006](../specs/0006-account-security.md))・AWS は OIDC(長期の鍵なし) | — |
| 4-1-4 | ○ | ○ | 端末のロック | A.8.1 | △ | — | 端末の管理で画面のロックを必ず |
| 4-1-5 | ○ | ○ | パスワードの設定のルール | A.5.17 | ○ | アプリのパスワードの決まり(Cognito)・[基本方針](policies/basic-policy.md) | 社内の道具のパスワードの決まりを規程に |
| 4-1-6 | ○ | ○ | パスワードの管理のルール | A.5.17 | ○ | 秘密は Secrets Manager・push の保護・[runbooks/secret-leak.md](../runbooks/secret-leak.md)・点検 `key-rotation` | パスワード管理の道具を決める |
| 4-1-7 | ○ | ○ | アクセス権の管理のルール | A.5.15・A.5.18 | ◎ | 権限の表 [authz/matrix.yaml](../authz/matrix.yaml)(CI で照らす)・点検 `access-review` | — |
| 4-1-8 | | ○ | サーバの置き場の入退室 | A.7.2 | 委 | サーバは AWS の中(事務所に置かない。soa の A.7) | AWS の第三者の認証を示す |
| 4-1-9 | | ○ | 持ち運べる記録の媒体の制限 | A.7.10 | △ | — | 規程に足す(USB など) |
| 4-2-1 | | ○ | 全員への意識向上の教育 | A.6.3 | ○ | [policies/training.md](policies/training.md)・点検 `training` | 年1回の教育と記録 |
| 4-2-2 | ○ | ○ | 事故のときの対応の教育・訓練 | A.6.3・A.5.24 | ○ | [runbooks/incident.md](../runbooks/incident.md)・戻す訓練([runbooks/db-restore.md](../runbooks/db-restore.md) の 5)・点検 `handover` | 年1回、手順書を通しでやる |
| 4-3-1 | | ○ | 保管するデータの暗号化 | A.8.24 | ◎ | DB とバックアップは KMS・要配慮は組織ごとの鍵(ADR 0029) | 社員の端末の暗号化(△) |
| 4-3-2 | | ○ | データの保管場所 | A.5.33・A.5.9 | ○ | [guides/data-retention.md](../guides/data-retention.md)(どこに・いつまで) | 社内の文書の置き場を規程に |
| 4-3-3 | | ○ | 取引先との情報共有と送り方 | A.5.14 | ○ | [ai-data.md](ai-data.md)・[guides/support-intake.md](../guides/support-intake.md)・[guides/sales-tools.md](../guides/sales-tools.md) | 社内の送り方の決まり |
| 4-3-4 | ○ | ○ | 適切なバックアップ | A.8.13 | ◎ | 時点復元と消せない保管庫(ADR 0012)・戻す訓練 | prod の apply 後3日以内の確かめ |
| 4-4-1 | ○ | ○ | 機器・OS・ソフトウェアの安全な構成 | A.8.9 | ◎ | Terraform・Trivy config・Security Hub の点検 | 社員の端末(△) |
| 4-4-2 | | ○ | サポート期限切れへの対策 | A.8.8 | ◎ | 点検 `eol` | — |
| 4-4-3 | | ○ | ログの取得と定期のレビュー | A.8.15・A.8.16 | ○ | 監査ログ・管理操作の記録(CloudTrail 400日)・アラーム | レビューの頻度と担当を決める |
| 4-4-4 | ○ | ○ | パッチとアップデートの手続 | A.8.8 | ◎ | Renovate・`/cve`・[runbooks/platform-vuln.md](../runbooks/platform-vuln.md) | 社員の端末の更新(△) |
| 4-4-5 | ○ | ○ | マルウェアからの保護 | A.8.7 | ○ | GuardDuty・イメージの検査(Trivy image) | 社員の端末の対策(△) |
| 4-5-1 | ○ | ○ | ネットワークの分離と境界の防護 | A.8.20・A.8.22 | ◎ | VPC とサブネット・セキュリティグループ・WAF | 事務所のネットワーク(△) |
| 5-1-1 | ○ | ○ | ネットワークの接続とデータ転送の監視 | A.8.16 | ◎ | VPC の流れのログ・WAF のログとアラーム・GuardDuty | — |
| 5-1-2 | | ○ | 機器とソフトウェアの挙動の監視 | A.8.16 | ◎ | アラーム([guides/monitoring.md](../guides/monitoring.md))・Sentry・外形監視 | 社員の端末(△) |
| 5-2-1 | | ○ | 事故のレベルと範囲 | A.5.25 | ◎ | [runbooks/incident.md](../runbooks/incident.md) の 1(S1〜S3) | — |
| 6-1-1 | ○ | ○ | 事故の対応の手順と体制 | A.5.24・A.5.26 | ◎ | [runbooks/incident.md](../runbooks/incident.md) と個別の手順書 | 指揮をとる人を決める |
| 7-1-1 | ○ | ○ | 事業を続けるための復旧の準備 | A.5.29・A.5.30・A.8.13 | ◎ | [runbooks/db-restore.md](../runbooks/db-restore.md)・[runbooks/deploy-rollback.md](../runbooks/deploy-rollback.md)・戻す訓練 | 復旧の目標(どれだけで戻すか)を決める |

## 使い方

- **★3 を求められたら**: ★3 の行(26件)の「使う人がやること」を先に埋める。△ と ○ が残る所が、自己評価で「できていない」になる所。
- **質問票**: `/security-questionnaire` が国の評価制度の問いに当たったら、この表の行を根拠に使う(この表は準備の表で、評価の結果ではないと添える)。
- 評価基準(細目)は一次資料の表で確かめる。ここに写していないので、細目ごとの当てはめは評価の前に一次資料で行う。
