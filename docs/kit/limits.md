# 🧾 できないこと・確かめていないこと

> 2026-10-29 作成。持ち主: @attumkwg。**何が手に入るか**は README の頭のカタログ、こちらは**手に入らない物と、自分で確かめてほしい物**を1か所にまとめたページ。
> 各行に「代わりにどうするか」と穴の番号を書いた。穴の一覧(正)は [../scenarios/gaps.md](../scenarios/gaps.md)、保守の方針は [maintenance.md](maintenance.md)。

<!-- いまの結論:start -->
## 📌 いまの結論(2026-10-29)

- 🚫 **できないこと**は3つ: 部品だけを既存のリポジトリに持ち帰る道・AWS と GitHub 以外への入れ替え・保守の約束。
- 🧍 **1人の間は**、本番の承認・戻す・1人分の削除を、持ち主1人と手順書で回す。AI のマージは既定でオフ。
- ☁️ **本物の AWS には一度も載せていない**。Terraform は AWS 無しで回る検査(`fmt`・`validate`・tflint・Trivy。`terraform.yml`)まで。stg を立てたら、下の 3 の表を上から確かめる。
- 💬 **クラウドで Slack から頼む道**は、使う側のリポジトリでつなぐ物で、キット自身では通していない。
- 🔒 ここに書いた物があっても、**機械が強制する守り**(必須のチェック・守るパス・危険度「高」の扱い)は1つも外していない。
<!-- いまの結論:end -->

## 1. できないこと

| できないこと | 代わりにどうするか | 穴 |
|---|---|---|
| 部品だけを、既存のリポジトリに持ち帰る | キットを丸ごと clone して始める。既存のリポジトリには、KPI の線(`docs/product/` の `personas.md`・`kpi.yaml` と `pnpm kpi`・`/persona`・`/council`)と考え方([../concepts/](../concepts/README.md))だけは持ち帰れる([../guides/kpi.md](../guides/kpi.md)) | G-51 |
| AWS・GitHub・Claude Code 以外に入れ替える(Azure・GitLab・Cursor など) | 入れ替えの地図は無い。替えるなら、`infra/terraform/`・`.github/`・`.claude/hooks/` を作り直す前提で見積もる | G-55(G-51 に束ねた) |
| 保守の約束(直すまでの日数・期限・SLA) | MIT・無保証。日数が要るなら、自社で持つか、支援する会社と契約する([maintenance.md](maintenance.md) の 5) | — |

## 2. 1人の間は、こう回す

| 1人の間の形 | 代わりにどうするか | 穴 |
|---|---|---|
| 本番の承認者は、`pnpm setup:github --apply` を打った1人(`.github/setup.yml` の `prod`) | 2人目が来たら `reviewers` に足し、`prevent_self_review: true` にする。それまでは押す前に [../runbooks/deploy-rollback.md](../runbooks/deploy-rollback.md) を開いておく | G-64 |
| 前の版に戻すのは `aws` のコマンド(ワークフローは無い) | [../runbooks/deploy-rollback.md](../runbooks/deploy-rollback.md) の 1.2。機能だけ止めるなら [../runbooks/feature-flags.md](../runbooks/feature-flags.md)。エンジニアでない人には打たせない | G-65 |
| 1人分の削除はコマンドが無い(数える「試し」まで) | [../runbooks/person-data.md](../runbooks/person-data.md) の 5 で、2人で手で消す | G-06 の残り |
| AI のマージは**既定でオフ** | 持ち主がクラウドの環境に `KIT_AI_MERGE=slack` を入れた所だけで動く。手元とコマンドの中で入れても、フックが止める([../guides/slack.md](../guides/slack.md)) | — |
| Slack の返事の**書き手を CI は確かめない** | 1人の間(承認 0)だけの割り切り([ADR 0082](../adr/0082-solo-conversation-answers-and-ai-merge.md))。人が増えて承認が 1 以上になると、自動で人の承認に戻る。スレッドと PR は後で読み返す | — |
| Slack の依頼のチャンネルは**自分だけ** | 外の人を入れない。共有チャンネル・外の人の Issue からは、マージまで進ませない(外の人の文章は、自分の言葉で Issue に書き直してから頼む。[../guides/unattended-ai.md](../guides/unattended-ai.md)) | — |

## 3. 確かめていないこと

### 3.1 本物の AWS の上(G-120)

> **手元と CI で確かめているのは**、Terraform の `fmt`・`validate`(状態につながずに)・tflint・Trivy(`.github/workflows/terraform.yml`)と、AWS の偽物の上のテストだけ。偽物は、Cognito(`docker-compose.cognito.yml`)・メール(Postfix → Mailpit。TLS も SES も通らない)・S3(RustFS)・DB(コンテナの Postgres。TLS なし)。
> 下の表は、**使う側で stg を立てたときに上から確かめる順**。「起きうること」は、コードを読んで立てた見込みで、本物で確かめた物ではない。🌐 = 外の相手が要る・🏭 = prod が要る。

| 順 | 何を(どこ) | どう確かめるか | 確かめないと何が起きうるか |
|---|---|---|---|
| 1 | 状態の置き場とロック(`backend "s3"`・`use_lockfile`。1つのバケットを dev・stg・prod がキーの頭で分ける) | バケットをどのアカウントに置き、ほかのアカウントの役割をどう許すかを決める → plan を2つ同時に流し、後の方が `.tflock` で待つ | ほかのアカウントの役割を許すバケットの方針が、コードにも手順にも無い。plan・プレビュー・掃除のどれかが AccessDenied で落ちる見込み |
| 2 | 初めての apply(`envs/preview/base` → `envs/stg`。[../guides/manual-setup.md](../guides/manual-setup.md) の 2-3) | apply が通り、2回目の plan が「No changes」 | ドメインの委任前は証明書の確認で止まる 🌐。新しいアカウントは CloudFront・Fargate の上限が低いことがある 🌐。組織で GuardDuty・Security Hub を有効にしていると「もうある」で落ちうる |
| 3 | 見張りの知らせ(`modules/alerts`・`modules/uptime`(us-east-1)・`modules/monitoring`) | manual-setup の 4 の `set-alarm-state` で東京と us-east-1 を鳴らし、Slack に出て OK に戻る | Slack をコンソールで許す前の apply は Chatbot で落ちる 🌐。最初のイメージが無い間は、数字が来ないアラームがすぐ鳴る |
| 4 | 最初のデプロイ(`deploy.yml`・`deploy-mail-relay.yml`・OIDC・移行・blue/green) | DB の接続ユーザーを作る(manual-setup の 2 の 4)→ 2つのワークフロー → 3つのサービスが running 1・`/readyz` が通り `/api/me` が 401 | OIDC の `sub` が合わないと役割を引けない。メールの中継は `deploy-mail-relay.yml` を流すまで動かない(手順は `deploy.yml` だけを書いている)。移行が10分を超えると待ちが切れる |
| 5 | 戻す(自動の blue/green・手の `update-service`。[../runbooks/deploy-rollback.md](../runbooks/deploy-rollback.md)) | stg に、わざと 5xx を返す版を出し、負荷をかけて自動で戻るのを見る → 1.2 で手で戻す | stg は人が少なく、5xx が1分に10件に届かず、壊れた版が残りうる |
| 6 | メール(`modules/ses-domain`・`modules/mail-relay`) 🌐 | [../runbooks/mail-not-delivered.md](../runbooks/mail-not-delivered.md) の 1-3。DKIM・SPF・DMARC が pass で、Gmail の受信箱に届く | SES の本番の申し込みが通るまで、確かめたアドレスにしか届かない。EFS の上で Postfix が起きるか(持ち主と権限)は手元で見ていない |
| 7 | 本物の Cognito(`envs/stg/cognito.tf`。確認コードは SES から) | `cognito-contract.yml` を流し、[../runbooks/cognito-login.md](../runbooks/cognito-login.md) の「stg で本物を確かめる」 | SES のドメインの確認が済む前にユーザープールを作ると、初めての apply が落ちる見込み(2回目で通る) |
| 8 | 入口(`modules/app-front`・`modules/waf`・`modules/public-site`) | [../runbooks/cloudfront-origin.md](../runbooks/cloudfront-origin.md) の 2(CloudFront からは開き、ALB に直接は届かない)と 3(ヘッダーの入れ替え) | CloudFront の送り元の一覧が、セキュリティグループの規則の上限の大半を使う |
| 9 | 写真・ファイル(`modules/file-storage`・組織ごとの一時の鍵) | [../runbooks/file-storage.md](../runbooks/file-storage.md) の 1。A の組織の URL を B に替えて 403・CloudTrail に組織の名前が出る | 組織をまたいで読めても、手元(固定の鍵の RustFS)では気づけない。ブラウザからの PUT が CORS で弾かれうる |
| 10 | 開通と運営のコマンド(`create-tenant`・`demo-reset.yml`) | [../runbooks/tenant-provisioning.md](../runbooks/tenant-provisioning.md) の 2-5 を stg で | 手元とプレビューでは通るが、run-task の権限と網は本物で初めて通る |
| 11 | DB(`modules/aurora`。TLS は `verify-full`・stg は `min_acu = 0`) | API が RDS の CA でつながる・CloudWatch の容量が 0 まで下がる | ALB が10秒ごとに `/readyz` で DB を見るので、stg の DB は止まらず、費用の目安より高くなる見込み |
| 12 | 戻す訓練(`modules/backup`・`restore-drill.yml`) 🏭 | `restore-drill.yml` を流し、Summary に表と行の数が出る。prod は [../runbooks/db-restore.md](../runbooks/db-restore.md) の 6 | 復元したクラスターで Data API が有効になるか・役割の権限が足りるかは本物でしか分からない(だめなら600秒待って落ちる)。prod の Vault Lock(compliance)は取り消せない |
| 13 | 管理操作の記録(`modules/audit-trail`。Object Lock の governance・400日) | [../runbooks/audit-trail.md](../runbooks/audit-trail.md) の 1 と 3 | stg でも400日はバケットを消せず、作り直し・`terraform destroy` が止まる |
| 14 | 費用の見張り(`modules/alerts` の Budgets・`modules/cost-watch`・`cost.yml`) 🌐 | Budgets の知らせが Slack に出る。Cost Explorer を有効にして翌日に `cost.yml` | 急な変化の見張りはタグ `Project` で絞る。タグを有効にする前(`activate_cost_allocation_tags` の既定)は何も拾わない見込み。有効にできるのは組織の管理のアカウントだけ |
| 15 | プレビューと試作(`preview.yml`・`cleanup-previews.yml`・`prototypes.yml`) | PR を1つ立てて閉じ、物と状態が消える | 取り残しの掃除が状態まで消すかは本物でしか分からない |
| 16 | SSO と SCIM(`envs/stg/sso.tf`・`/api/scim/v2`) 🌐 | [../runbooks/sso.md](../runbooks/sso.md) の 4 と 8。Okta や Entra の試しのテナントで、ログイン・必須化・SCIM の作る/止める | 手元は偽の IdP だけ。独自ドメインは親のドメインが引けないと作れない。WAF を block にしたとき SCIM の PATCH を止めないか |
| 17 | prod(`envs/prod`。stg のイメージを引く) 🏭 | stg の 1〜16 が済んでから apply → デプロイでイメージを引ける | ECR は自前の鍵で暗号化している。別のアカウントから引くのに鍵の方針が足りるかは要確認 |

- 🧭 外の相手が要る物: ドメインの委任・SES の本番の申し込み(AWS の審査)・Slack の許可(コンソール)・IdP の試しのテナント・上限の引き上げ(AWS のサポート)・コスト配分のタグ(組織の管理のアカウント)。
- 📝 確かめたら: 自分のリポジトリのこの表に「✅ 確かめた(日付・どの版)」を書き足す。キットの食い違いが見つかったら、キットの Issue で(穴なら [SECURITY.md](../../SECURITY.md) の道で)知らせてほしい。キットの表も直す。

### 3.2 クラウドで Slack から頼む道

- キット自身は Slack とつながない。**使う側のリポジトリで**つなぎ、本物の1件を通すのはそちら(G-124 の残り)。
- まだ見ていない物(クラウドの中で Docker が起きるか・スレッドの返事が同じ作業に届くか・中継を通ってマージできるか)と、だめだったときの代わりは [../guides/slack.md](../guides/slack.md) の「まだ確かめていない物」。

## 4. ほかの「確かめていない」の置き場

- セキュリティの検査で、何を確かめていて何を確かめていないか: [../security.md](../security.md)
- わざとやっていないこと(次の一歩): [../reference.md](../reference.md) の「📏 わざとやっていないこと」
- 費用の数は**推定**(Aurora の単価は公式の料金表で確かめていない): [../getting-started.md](../getting-started.md) の費用の節

最終更新: 2026-10-29
