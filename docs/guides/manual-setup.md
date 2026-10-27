# 手でやる設定(GitHub・AWS・OIDC・Slack・バックアップ・運営の組織)

> 2026-10-25 にルートの README の「🙋 本人が手でやる設定」から移した。中身は変えていない(README には入口だけを残した)。
> まず `pnpm setup:github` で一括でそろう物をそろえ、残りをここで人がやる。順番は [../getting-started.md](../getting-started.md)。

> 雛形を作っただけでは、AWS にもリポジトリの設定にも何も変えていない。下は人が判断して行う。

## 1. GitHub のリポジトリ設定

> **まず `pnpm setup:github`(試し: 差分だけ)→ よければ `pnpm setup:github --apply`。** 下の 1〜3・5〜7 は、これで一括でそろう(何度流しても同じ)。
> 値の正は `.github/setup.yml`(ブランチ保護・Environments・Actions・守りの機能)と `.github/labels.yml`(ラベル)。理由はファイルのコメントに、流し方と困ったときは [docs/guides/github-setup.md](github-setup.md)。
> 人が画面でやるのは 4(Renovate)と秘密の値だけ(セットアップが「人がやること」に出す)。設定ファイルを直した PR は、マージの後に `--apply` を流す。
>
> 🧍 **1人の間**と 👥 **人が増えたら**(レビューできる人が2人以上)で変わる所は、`.github/setup.yml` の値を変えて流し直す。
> 🌐 **公開か非公開か**でも使える物が変わる。非公開+Free では 1 と 3 ができない(表は [docs/guides/local-guards.md](local-guards.md))。

1. **ブランチ保護(main のルールセット)**: PR 必須・必須のチェック(`required_checks`。CI のジョブの名前と `pnpm setup:check` が突き合わせる)・最新の main に追いついてから(並べて出した PR が、合わさって main を赤くするのを防ぐ)・直線の履歴(マージは Squash か Rebase だけ)・消せない・強制 push できない。**例外(Bypass list)は空**(持ち主も例外にしない)
   - 🧍 1人の間: **承認は 0**。GitHub では自分の PR を自分で承認できず、AI の PR も自分のアカウントで出るので、1 にすると全部の PR が止まる。人の目の代わりに、必須のチェックと手元の守り([docs/guides/local-guards.md](local-guards.md))で止める
   - 👥 人が増えたら: 承認 1・CODEOWNERS の承認。危険度「高」を2人にするなら `ruleset.high_risk_approvals: 2`(必須のチェック「危険度「高」の承認の人数」が数える。承認数を 2 にすると全部の PR が2人になり、CODEOWNERS に2チームを並べても誰か1人で通るので、それでは「高だけ2人」にならない。仕様 0059)
   - マージキューを使うなら、`取り組みと作業の種類(PR の本文)` を必須から外す(キューの中では流れない)
2. **ラベル**: `.github/labels.yml` の全部(危険度・場所・Issue の種類・依存の更新・点検の知らせ・訓練の記録・VRT の撮り直し)。**何のラベルか・誰が付けるか・付いたらどうするかは [docs/guides/labels.md](labels.md)**(ほとんど自動で付き、人が手で付けるのは2つだけ)。コードが使うラベルが一覧に無ければ CI が落ちるので、「使うのに無い」は起きない。一覧に無いラベルは消さない
3. **Environments**: stg・prod・claude・zap を、どれも **main からだけ**使えるようにする。ワークフローの中でも main 以外は飛ばすが、ブランチのワークフローは書き換えられるので、GitHub の側でも止める(これが本当の守り)。main 以外のブランチを stg に出せると、prod は stg のイメージを引くので、承認1回でレビューされていないコードが本番に出てしまう
   - prod の承認する人: 🧍 1人の間は自分(流した人)・**自分の承認を許す**(止めると、自分でマージしたデプロイを誰も承認できない。承認は「本番に出す前に一度止まって見る」一手間)。👥 人が増えたら2人以上にして自分の承認を止める。🔒 非公開のリポジトリでは、Pro / Team でも承認する人を置けない(公開か Enterprise だけ)
   - 秘密の値は人が画面で: `claude` に `ANTHROPIC_API_KEY`(claude.yml)・`zap` に `ZAP_SCAN_USERNAME`・`ZAP_SCAN_PASSWORD`(zap-api-scan.yml)。下の 3. の表
4. **Renovate**(人が画面で): https://github.com/apps/renovate → Install(入っていれば Configure)→ 自分のアカウント → 「Only select repositories」でこのリポジトリだけ → Install。Mend の画面に移ったら GitHub でサインインして規約に同意する
   - `renovate.json` があるので、最初の設定の PR は出ずにそのまま動く。更新の PR は毎週月曜の朝9時前に最大5本(出てから3日たった版だけ)。脆弱性の直しはいつでも。自動マージはしない
   - 大きい版は PR にならず、Dependency Dashboard の Issue の「Pending Approval」に並ぶ。上げるときにチェックを入れる(Node と Postgres は PR の本文の ⚠️ のとおり、Renovate が読めない所も同じ PR で直す)
   - Mend の画面(https://developer.mend.io)でリポジトリの Mode が「Silent」だと、動いても PR も Dependency Dashboard も出ない。入れた後に Dashboard の Issue が出なければ、Settings で Silent を外す
5. **Secret scanning と push 保護**(秘密を含む push をその場で止める): 🌐 公開なら無料でオン。🔒 非公開は有料(GitHub Secret Protection)なのでセットアップは飛ばし、CI の gitleaks で代える。CI の gitleaks はどちらでも外さない(履歴の全部を毎回見る・`.gitleaksignore` で理由つきに除外できる)
6. **Actions の設定**: 書き込みが要るワークフローは、ファイルの中で `permissions:` を1つずつ足してあるので、既定は**読み取りだけ**。AI や Actions が自分の PR を**承認できない**。外の人の PR の実行は**毎回人が中身を見てから**(公開だと誰でも PR を出せる)。SHA で固定した Action だけ。成果物とログは**7日**(ZAP のレポートは `zaproxy/action-api-scan` が成果物を作るので、ワークフローから日数を決められない。レポートにはリクエストの中身が入りうる)
7. **Dependabot alerts**: オン(依存の脆弱性の知らせ。直す PR は Renovate が出すので、Dependabot の security updates はオフ)。🌐 公開なら「Private vulnerability reporting」もオン(外の人が脆弱性を Issue に書かずに、非公開で知らせられる)
8. **プレビューは dev アカウントだけ**: PR のプレビューが引く AWS の役割(`AWS_PREVIEW_ROLE_ARN`)は、PR の版のワークフローからも引ける(OIDC の `pull_request`)ので、PR を書ける人なら dev の中で動かせる。dev には**本物の秘密・本物のデータを置かない**(プレビューの DB はコンテナの Postgres+種データ)。prod の役割は PR から引けない

## 2. AWS アカウントと状態の置き場

1. AWS Organizations で **dev(プレビュー)・stg・prod** のアカウントを分ける(本番だけ別の鍵。AI が触れるのは dev まで)
2. 状態の S3 バケットを作る(バージョニング・暗号化・公開ブロックを有効に)。名前を GitHub の変数 `TF_STATE_BUCKET` に
3. 各 env で `*.example.tfvars` を `*.auto.tfvars` に写して値を入れ(コミットしない)、**人が** apply する:

```bash
cd infra/terraform/envs/stg && terraform init -backend-config="bucket=<バケット>" -backend-config="key=stg/terraform.tfstate" -backend-config="region=ap-northeast-1" -backend-config="use_lockfile=true" && terraform apply
```

   順番: `envs/preview/base`(dev)→ `envs/stg` → `envs/prod`。最初はイメージが無いので、ECS のサービスは deploy.yml の初回で動き出す。

4. **アプリの接続ユーザーを1回だけ作る**(stg と prod)。RDS のコンソール → クエリエディタで、マスターユーザー(`app_owner`。パスワードは Secrets Manager の RDS 管理の秘密)でつなぎ、パスワードは Secrets Manager の `<name>/database-url` の中の値を使う:

```sql
CREATE ROLE app_rw NOLOGIN;
CREATE ROLE app LOGIN PASSWORD '<database-url の中のパスワード>' NOSUPERUSER NOBYPASSRLS IN ROLE app_rw;
```

   要配慮個人情報を扱うとき(Terraform の `sensitive_data_enabled = true` にした後)だけ、要配慮だけの接続ユーザーも作る(パスワードは `<name>/sensitive-database-url` の中の値。ロール `app_sensitive` は移行が作る。[docs/runbooks/sensitive-data-tiers.md](../runbooks/sensitive-data-tiers.md) の 1):

```sql
CREATE ROLE app_sensitive_login LOGIN PASSWORD '<sensitive-database-url の中のパスワード>' NOSUPERUSER NOBYPASSRLS IN ROLE app_sensitive;
```

## 3. OIDC の役割と GitHub の変数・秘密

Terraform の出力(`github_role_arns` など)を、Settings → Secrets and variables → Actions の **Variables** に入れる(秘密ではないので Variables):

| 変数 | 値 | 使うワークフロー |
|---|---|---|
| `TF_STATE_BUCKET` | 状態のバケット | terraform・preview・cleanup |
| `AWS_STG_PLAN_ROLE_ARN` / `AWS_PROD_PLAN_ROLE_ARN` | `<project>-<env>-plan`(**prod は main からだけ**引ける。PR の plan は stg だけ) | terraform(plan) |
| `TF_VARS_STG` / `TF_VARS_PROD` | `*.auto.tfvars` の中身(秘密は入れない) | terraform(plan) |
| `AWS_PREVIEW_ROLE_ARN` | `preview-github` | preview・cleanup |
| `PREVIEW_ECR_REPOSITORY` / `PREVIEW_WEB_ECR_REPOSITORY` / `PREVIEW_DOMAIN` | preview/base の出力(API / 画面)/ `example.com` | preview |
| `AWS_STG_DEPLOY_ROLE_ARN` / `AWS_PROD_DEPLOY_ROLE_ARN` | `<project>-<env>-deploy` | deploy |
| `ECR_REPOSITORY_URL` / `WEB_ECR_REPOSITORY_URL` | stg の出力(API / 画面) | deploy |
| `MAIL_ECR_REPOSITORY_URL` | stg の出力 `mail_ecr_repository_url`(メールの中継) | deploy-mail-relay |
| `AWS_STG_RESTORE_DRILL_ROLE_ARN` / `STG_DB_CLUSTER` | stg の出力(`github_role_arns` の `…-restore-drill`・`db_cluster_identifier`) | restore-drill(毎月の戻す訓練) |
| `AWS_STG_COGNITO_CONTRACT_ROLE_ARN` / `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` | stg の出力(`github_role_arns` の `…-cognito-contract`・`cognito_user_pool_id`・`cognito_client_id`) | cognito-contract |
| `STG_URL` / `PROD_URL` | `https://app.stg.example.com` など | deploy(疎通) |
| `STG_SITE_BUCKET` / `STG_SITE_DISTRIBUTION_ID` / `STG_SITE_URL`(prod は `PROD_…`) | stg・prod の出力 `public_site`(`*.auto.tfvars` に `public_site_domain` を入れて apply したときだけ。docs/guides/landing-page.md) | deploy(公開の LP を置く。無ければ飛ばす) |
| `PROJECT` | 名前の頭(既定 `sfs`) | deploy |
| `DEMO_TENANT_ID` | stg のデモ用の組織の ID(先に stg で `create-tenant`。[sales.md](sales.md) の 1) | demo-reset(デモの前に手で) |

**Secrets** は、リポジトリ全体(Repository secrets)には置かず、**使う Environment の秘密**(Settings → Environments → 名前 → Environment secrets)に置く。Environment は main だけに絞ってあるので(上の 1. の 3)、PR のブランチのワークフローからは読めない:

| 秘密 | 置く Environment | 使うワークフロー |
|---|---|---|
| `ANTHROPIC_API_KEY` | `claude` | claude(`@claude`)。Claude の GitHub App を入れて使う方法もある |
| `ZAP_SCAN_USERNAME`・`ZAP_SCAN_PASSWORD` | `zap` | zap-api-scan(stg のスキャン用の利用者) |

すでに Repository secrets に入れていたら、Environment に入れ直してから Repository secrets の方を消す。

## 4. 見張りの知らせを Slack に流す

1. stg と prod の AWS アカウントそれぞれで、コンソールの「Amazon Q Developer in chat applications」(旧 AWS Chatbot)から Slack のワークスペースを許可する(ワークスペースの ID `T…` が分かる)
2. Slack に `#alerts-stg` と `#alerts-prod` を作り、チャンネルの ID(`C…`)を `*.auto.tfvars` の `slack_team_id` / `slack_channel_id` に入れて apply
3. 試しに鳴らして Slack に出るのを確かめる。**東京とバージニア(us-east-1)の両方**を鳴らす。外形監視(利用者から開けるか)と、CloudFront の前の WAF のアラームはバージニアにあり、その知らせも同じ Slack のチャンネルに届く(`modules/alerts` の `extra_topic_arns`)。外形監視はいちばん大事な知らせなので、**Slack に出なければ先へ進まない**(メールだけでは気づけない)。

   ```bash
   N=<project>-<env>   # 例: sfs-prod
   # 東京(中のアラーム)
   aws cloudwatch set-alarm-state --alarm-name "$N-elb-5xx" --state-value ALARM --state-reason "Slack の確かめ"
   # バージニア(外形監視の画面と API・CloudFront の前の WAF)
   for a in "$N-uptime-web" "$N-uptime-api" "$N-front-waf-hits"; do
     aws cloudwatch set-alarm-state --region us-east-1 --alarm-name "$a" --state-value ALARM --state-reason "Slack の確かめ"
   done
   ```

   Slack に「ALARM」が4つ出て、次の見張り(数十秒〜数分)で「OK」に戻るのを確かめる。出なければ、`slack_team_id` / `slack_channel_id`・Amazon Q Developer in chat applications の設定の「SNS のトピック」に両方の topic があるか(`<N>-alerts` と `<N>-uptime-alerts`)を見る。月の上限(`monthly_budget_usd`)も見直す

## 5. バックアップと管理操作の記録(prod は確かめてから)

prod のバックアップの保管庫は **compliance のロック**で、apply から3日を過ぎると、ロックも保存の期間も誰にも変えられない(root でも)。**3日のうちに**、保管庫・毎日 35日・毎月 365日・1回目のバックアップが取れたこと、を確かめる([docs/runbooks/db-restore.md](../runbooks/db-restore.md) の 6)。prod の戻す訓練は四半期に1回、手で(同じ手順書の 5)。

管理操作の記録(CloudTrail)の S3 は、stg・prod とも **governance のロック**(400日。外す権限はバケットの方針で全員に拒否し、消すと鳴る)。**prod に apply する前に**保存の日数と、誰にも消せない compliance にするかを決め、apply の後に記録が流れていることを確かめる([docs/runbooks/audit-trail.md](../runbooks/audit-trail.md) の 1 と 2)。委託先の台帳(`docs/compliance/vendors.yaml`)の契約の欄も、自分の契約に書き直す([docs/compliance/README.md](../compliance/README.md))。

## 6. サポートの代理ログイン(運営の組織)

社員がお客さんの画面を見るのは、お客さんの管理者が許可した間だけ・見るだけ(docs/specs/0004-support-access.md)。本番の DB に「運営の組織」と社員を1回だけ作り、その ID を `*.auto.tfvars` の `support_tenant_id` に入れて apply する。手順は [docs/runbooks/support-access.md](../runbooks/support-access.md)。手元とプレビューは種データの `support@ops.test` で試せる。

手順・何を見張っているか・費用は [docs/guides/monitoring.md](monitoring.md)。鳴ったら [docs/runbooks/alarms.md](../runbooks/alarms.md)、Sentry に来たら [docs/runbooks/sentry.md](../runbooks/sentry.md)。
