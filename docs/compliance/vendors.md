# 委託先の一覧

> **生成物。手で直さない。** 正は [vendors.yaml](vendors.yaml)。直したら `pnpm vendors --write`(作り忘れは CI が落とす)。
> 決まりは [設計書 0017](../designs/0017-vendors-ai-data-audit-trail.md)・AI に渡してよいデータは [ai-data.md](ai-data.md)。
> 契約の欄は「公開の約款を確かめた」まで。使う人は自分の契約(プラン・置き場所・保存の日数)を確かめて vendors.yaml を書き直す。

## 使っている会社

| 会社 | 預け方 | 置き場所 | 渡す区分 | 契約(DPA) | 第三者の認証 |
|---|---|---|---|---|---|
| Amazon Web Services(AWS) | 委託 | 日本(東京 ap-northeast-1)。外形監視のアラーム・CloudFront の証明書だけ米国(us-east-1。個人データは置かない) | public・internal・personal | 約款に含む | ISO/IEC 27001・ISO/IEC 27017・ISO/IEC 27018・SOC 2 Type II・ISMAP |
| GitHub | 委託 | 米国 | internal | 未確認 | ISO/IEC 27001・SOC 2 Type II |
| Sentry(Functional Software) | 委託 | 米国(EU の置き場も選べる。どちらにしたかを書く) | internal | 未確認 | ISO/IEC 27001・SOC 2 Type II |
| Anthropic(Claude・Claude Code) | 委託(AI) | 米国 | internal | 未確認 | ISO/IEC 27001・ISO/IEC 42001・SOC 2 Type II |
| Slack(Salesforce) | 委託 | 米国 | internal | 未確認 | ISO/IEC 27001・SOC 2 Type II |
| Renovate(Mend.io の GitHub App) | 渡さない | 米国 | なし | 不要 | なし |
| Docker(Docker Hub・Buildx の Actions) | 渡さない | 米国 | なし | 不要 | なし |
| HashiCorp(Terraform・その登録簿) | 渡さない | 米国 | なし | 不要 | なし |
| 公開の道具(pnpm・TFLint・ZAP) | 渡さない | なし(CI の中で動く) | なし | 不要 | なし |

区分は `apps/api/src/db/classification.ts` と同じ: public(選択肢・真偽)/ internal(ID・時刻・回数)/ personal(個人情報・自由な文)/ sensitive(要配慮)。

## 会社ごと

### Amazon Web Services(AWS)

- 何に使うか: 本番・stg・プレビューの動く所すべて(DB・ログイン・メールの送信・ログ・バックアップ・管理操作の記録)
- 預け方: 委託
- 置き場所: 日本(東京 ap-northeast-1)。外形監視のアラーム・CloudFront の証明書だけ米国(us-east-1。個人データは置かない)
- 渡す区分: public・internal・personal
- 契約(DPA): 約款に含む(https://d1.awsstatic.com/legal/aws-dpa/aws-dpa.pdf)。AWS のサービス条件(https://aws.amazon.com/service-terms/)に DPA が組み込まれる。別に署名しなくてよい
- 第三者の認証: ISO/IEC 27001・ISO/IEC 27017・ISO/IEC 27018・SOC 2 Type II・ISMAP(https://aws.amazon.com/compliance/programs/)
- 使うのをやめたとき: アカウントを閉じると、90日の猶予のあとに中身が消える。消せない保管庫(バックアップ・管理操作の記録)は期限まで残る
- お客さんが解約したとき: 解約の削除のコマンドで DB と Cognito から消す。バックアップは保存の期限(最長1年)で消える(docs/runbooks/offboarding.md)
- 公開の約款と認証を確かめた日: 2026-10-25
- コードで使っている SDK: `@aws-sdk/client-cognito-identity-provider`・`@aws-sdk/client-kms`・`@aws-sdk/client-s3`・`@aws-sdk/client-sts`・`@aws-sdk/s3-request-presigner`
- ワークフローで使っている Actions: `aws-actions/amazon-ecr-login`・`aws-actions/amazon-ecs-deploy-task-definition`・`aws-actions/amazon-ecs-render-task-definition`・`aws-actions/configure-aws-credentials`

### GitHub

- 何に使うか: ソースコード・Issue・PR・CI(Actions)・依存の通知(Dependabot)・npm の取得元
- 預け方: 委託
- 置き場所: 米国
- 渡す区分: internal
- 契約(DPA): 未確認(https://github.com/customer-terms)。有料のプランの約款に DPA がある。無料のプランで使うなら、何に同意しているかを確かめる
- 第三者の認証: ISO/IEC 27001・SOC 2 Type II(https://github.com/security)
- 使うのをやめたとき: リポジトリを消すと、90日は戻せる状態で残り、そのあと消える。Actions の成果物とログは保存の日数(7日)で消える
- お客さんが解約したとき: 残らない(Issue・PR にお客さんの個人データを書かない決まり。docs/compliance/ai-data.md)
- 公開の約款と認証を確かめた日: 2026-10-25
- ワークフローで使っている Actions: `actions/checkout`・`actions/download-artifact`・`actions/github-script`・`actions/labeler`・`actions/setup-node`・`actions/upload-artifact`

### Sentry(Functional Software)

- 何に使うか: API・画面のサーバー・ブラウザの失敗の記録(ADR 0011)
- 預け方: 委託
- 置き場所: 米国(EU の置き場も選べる。どちらにしたかを書く)
- 渡す区分: internal
- 契約(DPA): 未確認(https://sentry.io/legal/dpa/)
- 第三者の認証: ISO/IEC 27001・SOC 2 Type II(https://sentry.io/security/)
- 使うのをやめたとき: 組織を消すと消える。それまでは保存の日数(プランで決まる)で古い物から消える
- お客さんが解約したとき: 利用者の ID だけが残り、保存の日数で消える(値は送る前に落としている。packages/error-reporting)
- 公開の約款と認証を確かめた日: 2026-10-25
- コードで使っている SDK: `@sentry/browser`・`@sentry/node`

### Anthropic(Claude・Claude Code)

- 何に使うか: AI が作る・調べる(Claude Code・@claude の Actions)。渡すのはコード・設計書・ID と集計まで(docs/compliance/ai-data.md)
- 預け方: 委託(AI の会社。personal・sensitive は渡さない)
- 置き場所: 米国
- 渡す区分: internal
- 契約(DPA): 未確認(https://www.anthropic.com/legal/commercial-terms)。商用の約款に DPA(https://www.anthropic.com/legal/data-processing-addendum)。入れた物を学習に使わないこと・保存の日数を、自分の契約で確かめる
- 第三者の認証: ISO/IEC 27001・ISO/IEC 42001・SOC 2 Type II(https://trust.anthropic.com/)
- 使うのをやめたとき: 契約の保存の日数で消える(日数は契約と設定で確かめる)
- お客さんが解約したとき: 残らない(お客さんの個人データを渡さない決まり)
- 公開の約款と認証を確かめた日: 2026-10-25
- ワークフローで使っている Actions: `anthropics/claude-code-action`

### Slack(Salesforce)

- 何に使うか: アラームと点検の知らせ(AWS Chatbot・checkup.yml)・障害のときのやり取り
- 預け方: 委託
- 置き場所: 米国
- 渡す区分: internal
- 契約(DPA): 未確認(https://slack.com/terms-of-service/data-processing)
- 第三者の認証: ISO/IEC 27001・SOC 2 Type II(https://slack.com/trust/compliance)
- 使うのをやめたとき: ワークスペースを消すと消える
- お客さんが解約したとき: 残らない(知らせに個人データを入れない。障害のスレッドにも ID だけを書く)
- 公開の約款と認証を確かめた日: 2026-10-25

### Renovate(Mend.io の GitHub App)

- 何に使うか: 依存の更新の PR を出す。リポジトリのコードを読む
- 預け方: 渡さない
- 置き場所: 米国
- 渡す区分: なし
- 契約(DPA): 不要(https://docs.renovatebot.com/security-and-permissions/)
- 第三者の認証: なし
- 使うのをやめたとき: GitHub App を外す
- お客さんが解約したとき: 関係しない
- 公開の約款と認証を確かめた日: 2026-10-25

### Docker(Docker Hub・Buildx の Actions)

- 何に使うか: CI でのイメージの作成と、検査の道具のイメージの取得
- 預け方: 渡さない
- 置き場所: 米国
- 渡す区分: なし
- 契約(DPA): 不要(https://www.docker.com/legal/docker-subscription-service-agreement/)
- 第三者の認証: なし
- 使うのをやめたとき: 関係しない(預けている物は無い)
- お客さんが解約したとき: 関係しない
- 公開の約款と認証を確かめた日: 2026-10-25
- ワークフローで使っている Actions: `docker/build-push-action`・`docker/setup-buildx-action`

### HashiCorp(Terraform・その登録簿)

- 何に使うか: Terraform の本体と提供者(providers)の取得。状態ファイルは自分の S3 に置く(HCP は使わない)
- 預け方: 渡さない
- 置き場所: 米国
- 渡す区分: なし
- 契約(DPA): 不要(https://registry.terraform.io/)
- 第三者の認証: なし
- 使うのをやめたとき: 関係しない
- お客さんが解約したとき: 関係しない
- 公開の約款と認証を確かめた日: 2026-10-25
- ワークフローで使っている Actions: `hashicorp/setup-terraform`

### 公開の道具(pnpm・TFLint・ZAP)

- 何に使うか: CI の中で動く公開の道具(SHA で固定)。ZAP は試しのアカウントで stg を叩く
- 預け方: 渡さない
- 置き場所: なし(CI の中で動く)
- 渡す区分: なし
- 契約(DPA): 不要(https://github.com/pnpm/action-setup)
- 第三者の認証: なし
- 使うのをやめたとき: 関係しない
- お客さんが解約したとき: 関係しない
- 公開の約款と認証を確かめた日: 2026-10-25
- ワークフローで使っている Actions: `pnpm/action-setup`・`terraform-linters/setup-tflint`・`zaproxy/action-api-scan`・`zaproxy/action-baseline`

### Amazon Web Services(AWS) のサービスごとの区分

| サービス | 渡す区分 | Terraform の資源の種類 | 補足 |
|---|---|---|---|
| Aurora(RDS。DB) | public・internal・personal | `aws_rds_*`・`aws_db_*` | 要配慮(sensitive)の置き場所(スキーマ sensitive・専用のロール・組織ごとのデータ鍵で暗号化)は入っている(ADR 0029)が、キットには要配慮の列が無い。列を足したら、ここと AWS Backup・ECS・ELB と上の data に sensitive を足す(DB とバックアップには暗号文だけ。ECS のメモリと ALB は値そのものが通る) |
| AWS Backup(DB の写し) | public・internal・personal | `aws_backup_*` |  |
| Cognito(ログイン) | internal・personal | `aws_cognito_*` | メールアドレス・パスワードのハッシュ・二段階認証の鍵 |
| SES(メールの送信) | internal・personal | `aws_sesv2_*` | 宛先と本文(名前・題名が入る) |
| EFS(メールの中継の送信待ち) | internal・personal | `aws_efs_*` |  |
| ECS・ECR・Cloud Map・Application Auto Scaling(アプリを動かす) | public・internal・personal | `aws_ecs_*`・`aws_ecr_*`・`aws_service_discovery_*`・`aws_appautoscaling_*` | 動いている間のメモリの中だけ。イメージに個人データは入れない |
| ELB(ALB。入口) | internal・personal | `aws_lb`・`aws_lb_*` | 通るだけ(TLS をここで解く)。アクセスログは取っていない |
| WAF | internal・personal | `aws_wafv2_*` | ログは IP・URL(検索の値が入る)・ヘッダー(Cookie と Authorization は伏せる)。30日 |
| CloudWatch(ログ・メトリクス・アラーム)・EventBridge | internal・personal | `aws_cloudwatch_*` | アプリのログは許可リストの項目だけ(ADR 0019)。personal が入るのは WAF のログ(URL の検索の値)だけ |
| CloudTrail(管理操作の記録) | internal | `aws_cloudtrail` | 誰が・いつ・どの API を呼んだか(社員の IAM の名前と IP を含む)。ロックした S3 に置く(docs/runbooks/audit-trail.md) |
| S3 | public・internal・personal | `aws_s3_*` | 管理操作の記録・毎月の証跡(設定の写し。社員の GitHub と IAM の名前を含む)・費用のページ・試作の画面(偽のデータだけ)。personal は申し込みの置き場だけ(開通のとき、申込書の JSON = 組織の名前・最初の管理者の名前とメールを置き、create-tenant が読む。読み終えたら人が消す・今の版は7日・古い版は1日で消える。docs/runbooks/tenant-provisioning.md)と、写真・ファイルの置き場(お客さんが上げた写真・PDF。人・表札が写りうる。組織の ID を頭にしたキー・組織ごとに絞った権限・位置情報を消してから見せる・消した物の前の版は30日・解約で前の版まで消す。modules/file-storage・docs/runbooks/file-storage.md)。それ以外にお客さんのデータは置かない |
| CloudFront(試作の画面の配信) | public | `aws_cloudfront_*` |  |
| VPC(ネットワーク) | internal | `aws_vpc`・`aws_vpc_*`・`aws_subnet`・`aws_subnets`・`aws_route`・`aws_route_table`・`aws_route_table_association`・`aws_internet_gateway`・`aws_nat_gateway`・`aws_eip`・`aws_security_group`・`aws_default_security_group`・`aws_ec2_managed_prefix_list`・`aws_flow_log`・`aws_availability_zones` | フローログ(IP と通信の量。中身は無い) |
| IAM・KMS・Secrets Manager・ACM(鍵と権限) | internal | `aws_iam_*`・`aws_kms_*`・`aws_secretsmanager_*`・`aws_acm_*`・`aws_caller_identity`・`aws_region`・`aws_partition` | KMS は要配慮の組織ごとのデータ鍵も包む(modules/sensitive-data。SDK @aws-sdk/client-kms)。渡すのは組織の ID(文脈)とデータ鍵だけで、要配慮の値は渡さない |
| Route 53(DNS・外形監視) | public | `aws_route53_*` | 外形監視は世界の何か所かから公開のページを開くだけ |
| GuardDuty・Security Hub(見張り) | internal | `aws_guardduty_*`・`aws_securityhub_*` |  |
| SNS・AWS Chatbot・Budgets・Cost Explorer(知らせ・予算・費用の集計と急な変化の見張り) | internal | `aws_sns_*`・`aws_chatbot_*`・`aws_budgets_*`・`aws_ce_*` | 知らせの中身はアラームの名前と数だけ。Chatbot から先は Slack(下の slack)。Cost Explorer はこのアカウントの請求の集計を読むだけ(コスト配分タグ・費用の急な変化。docs/guides/cost-dashboard.md) |
