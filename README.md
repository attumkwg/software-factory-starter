# software-factory-starter

AI エージェント前提でゼロから作るプロダクトの **動く雛形+設定一式**(TypeScript・AWS・Terraform・GitHub Actions)。

題材は小さな **マルチテナントの TODO アプリ**(組織 → プロジェクト → タスク。ロールは admin / member / viewer)。
中身より「ライン」(検査・権限の表・テナント分離・プレビュー環境・危険度で分けたレビュー・AI のハーネス)を見るための物です。

- ✅ 手元で動く: `docker compose up --build` で API+画面(SSR)+DB+ALB の代わり、`pnpm test` で単体、`pnpm test:integration` で本物の Postgres を使った結合テスト、`pnpm test:e2e` で画面の E2E。
- ✅ CI は **AWS も API キーも無しで緑**。AWS・Claude を使うジョブは、変数が無ければ失敗せずに飛ぶ。
- ⛔ AWS へのデプロイはしていない。Terraform は `fmt` と `validate` まで(apply は下の「本人がやる設定」のあと)。

📘 **はじめての人は [docs/getting-started.md](docs/getting-started.md)(使い始めの手引き)から**。docs 全体の地図は [docs/README.md](docs/README.md)。

---

## 🗺 全体の地図

```
.
├─ apps/
│  ├─ api/                      Hono+Zod+zod-openapi の API(OpenAPI を自動生成)
│  │  ├─ src/app.ts             組み立て(request ID → セッション → 認可の関所 → ルート)
│  │  ├─ src/index.ts           起動と SIGTERM での停止
│  │  ├─ src/cli.ts             移行・種データ・使い捨て DB のロール作成
│  │  ├─ src/auth/              認証: 開発用ログイン / Cognito(自前の画面 → API → Cognito の API。トークンはサーバーの中だけ)・署名つき Cookie
│  │  ├─ src/authz/             認可: 既定は拒否のポリシー(policy.ts)と関所(middleware.ts)
│  │  ├─ src/db/                Drizzle のスキーマ・withTenant(SET LOCAL)・種データ
│  │  ├─ src/domains/           領域ごと(organizations・projects・tasks)の表・読み書き・API。ほかからは index.ts だけ
│  │  ├─ src/outbox/            送信待ち(アウトボックス)と、その送り出し
│  │  ├─ src/http/              API の入力と出力の共通の形
│  │  ├─ drizzle/               移行の SQL(0001_rls.sql が RLS)
│  │  ├─ db/init/               手元・テスト用の接続ユーザーの作成
│  │  ├─ test/unit/             DB 無しのテスト(権限の表の網羅 ① を含む)
│  │  ├─ test/integration/      Testcontainers の Postgres(RLS・2社・権限の表 ②)
│  │  └─ Dockerfile             distroless・root で動かさない(API と移行だけ。画面は配らない)
│  └─ web/                      TanStack Start の SSR(ログイン → プロジェクト → タスク)と Playwright の E2E
│     ├─ src/routes/            画面と URL(ファイルの置き場所が URL になる)。loader が SSR でデータを読む
│     ├─ src/pages/             画面の中身(@app/ui の部品だけ)
│     ├─ src/api.ts             API の呼び出し(ブラウザからは /api、SSR からは API_INTERNAL_URL)
│     ├─ server/                本番の Node サーバー(静的ファイル・/readyz・SSR への受け渡し)
│     └─ Dockerfile             distroless・1つにまとめた JS だけ(node_modules も秘密も無い)
├─ packages/shared/             画面と API の契約(Zod のスキーマと型)
├─ packages/ui/                 デザインシステム(React Aria の部品とトークン)
├─ packages/error-reporting/   error 以上のログを Sentry に送る(値を落としてから。API と画面のサーバー)。ブラウザは apps/web/src/report-error.ts
├─ packages/fake-cognito/       開発とテスト専用の偽物の Cognito(依存なし)と、本物と比べる契約テスト(contract/)
├─ docker/postfix/              メールの中継(Postfix)。本番は ECS(送り待ちは EFS)→ SES、手元は Mailpit
├─ docs/
│  ├─ authz/matrix.yaml         権限の表(人がレビューする「誰に何を許すか」)
│  ├─ specs/                    仕様のテンプレートと例(受け入れ条件・悪用のされ方)
│  ├─ adr/                      設計判断のテンプレートと例(共有の表+RLS・デザインシステム・SSR・領域・お金と時刻・アウトボックス・Cognito のログイン・メール・自前のログイン画面)
│  └─ runbooks/                 手順書の例(他社のデータが見えたかもしれない・Cognito でのログイン)
├─ infra/terraform/
│  ├─ modules/                  network・ecs-service(API+共有 ALB・blue/green)・web-service(画面の SSR)・mail-relay(Postfix+EFS)・ses-domain・aurora・alerts(SNS → Slack・費用の警報)・monitoring(アラーム)・preview-env・github-oidc
│  └─ envs/                     stg・prod・preview/base(共有の土台)・preview/pr(PR ごと)
├─ .github/
│  ├─ workflows/                ci・terraform・preview・cleanup-previews・deploy・claude・labeler
│  ├─ pull_request_template.md  仕様・危険度・テスト結果・プレビュー・スクショ・判断してほしい所
│  ├─ ISSUE_TEMPLATE/           受け入れ条件つきの Issue
│  ├─ CODEOWNERS / labeler.yml  危険度「高」のパス
│  └─ scripts/run-migration.sh  ECS の1回きりのタスクで移行
├─ .claude/                     ハーネス(フック・スキル)。settings.json は下の注意を参照
├─ .semgrep/                    自社専用の検査ルールとそのテスト
├─ .devcontainer/               人も AI も同じ開発環境
├─ CLAUDE.md                    全体のルール(apps/api・apps/web にも短いものがある)
├─ docker-compose.yml           手元で丸ごと動かす(docker/alb.Caddyfile が ALB の代わり)
└─ renovate.json                依存の更新(危険度のラベルつき)
```

## 🚀 手元での動かし方

前提: **Node.js 24(LTS)**・Docker。pnpm は Node に入っている corepack で入る。

```bash
corepack enable
```

```bash
pnpm install
```

```bash
pnpm test
```

DB を使う結合テスト(Docker が要る。Testcontainers が Postgres を立てて消す):

```bash
pnpm test:integration
```

丸ごと起動(DB → 移行 → 種データ → API → 画面の SSR → ALB の代わり)。http://localhost:8080 を開き、`admin@acme.test` などでログイン:

```bash
docker compose up --build
```

画面の E2E(上の起動のあとで。初回だけ `pnpm --filter @app/web exec playwright install chromium`):

```bash
pnpm test:e2e
```

開発するとき(API は 3000、画面は 5173。画面は SSR のまま自動で読み直し、/api は API へ中継する):

```bash
docker compose up -d db
```

```bash
cp apps/api/.env.example apps/api/.env && pnpm db:migrate && pnpm db:seed && pnpm dev
```

種データは **必ず2社**: Acme(`admin@acme.test` / `member@acme.test` / `viewer@acme.test`)と Globex(`admin@globex.test`)。

その他: `pnpm lint`(Biome)・`pnpm typecheck`・`pnpm openapi`(apps/api/openapi.json を書き出す)・`pnpm --filter @app/api db:lint`(squawk)。

---

## 🧭 設計(my-life の docs/software-factory)との対応

### 7工程

| 工程 | この雛形のどこ |
|---|---|
| ① 受付 | `.github/ISSUE_TEMPLATE/`(機能・不具合。不具合には requestId の欄) |
| ② 振り分け | Issue の危険度の見込み・`needs-triage` ラベル |
| ③ 仕様 | `docs/specs/`(受け入れ条件・権限の表の行・STRIDE)・`docs/adr/` |
| ④ 実装 | `CLAUDE.md`・`.claude/skills/`・`.github/workflows/claude.yml`(`@claude`) |
| ⑤ 検証 | `ci.yml`(型・lint・単体・結合・E2E・検査)・`preview.yml`(PR ごとの環境で E2E と ZAP) |
| ⑥ レビュー | `pull_request_template.md`(判断してほしい所を一番上)・`CODEOWNERS`・`labeler.yml` |
| ⑦ 出荷と監視 | `deploy.yml`(stg 自動 → prod 承認 → ECS の blue/green)・`ecs-service` の 5xx アラームで自動で戻す・構造化ログ |

### 危険度(人が見る量を決める)

| | どこで決まるか |
|---|---|
| パスで自動でラベル | `.github/labeler.yml`(`risk:high` / `risk:medium` / `risk:low`) |
| 「高」は2人 | `.github/CODEOWNERS`(認証・認可・権限の表・移行・infra・.github・ハーネス)+ブランチ保護(下) |
| PR で自己申告 | `pull_request_template.md`(食い違ったら高い方) |
| 依存の更新 | `renovate.json`(開発用の小さい更新は low、major・CI・インフラは high) |
| AI に変えさせない所 | `.claude/settings.json` の `ask`(CI・権限・移行・infra を編集するときは人の確認) |

### ハーネス3層

| 層 | この雛形のどこ |
|---|---|
| ① 手元の Claude Code | `CLAUDE.md`(全体・api・web)・`.claude/settings.json` のフック(書いたら Biome・終わる前に型と影響範囲のテスト。2回落ちたら人へ)・`.claude/skills/`(API を足す / DB の移行 / リリースノート)・`.devcontainer/` |
| ② 背景エージェント | `.github/workflows/claude.yml`(Issue / PR の `@claude`。OWNER / MEMBER だけが起動できる) |
| ③ 自前のファクトリー | まだ作らない(PR が週に数十件を超えてから) |

### テナント分離(共有の表+RLS)

| 層 | この雛形のどこ |
|---|---|
| 全テーブルに tenant_id(UUIDv7)・(tenant_id, id) の組で参照 | `apps/api/src/domains/*/schema.ts` |
| テナントはセッションからだけ | `src/auth/session.ts`(署名つき Cookie)・`src/authz/middleware.ts` |
| トランザクションごとに `SET LOCAL app.tenant_id` | `src/db/tenant.ts`(`set_config(..., true)`) |
| RLS+FORCE・接続ユーザーは持ち主ではない | `drizzle/0001_rls.sql`・`db/init/001-roles.sql` |
| アプリ側でも絞る | `src/domains/*/repository.ts`(`tenantId` で WHERE) |
| 書き忘れを機械で止める | `.semgrep/rules.yml`(`tenant-scoped-db-only` / `tenant-from-request`) |
| 確かめるテスト | `test/integration/rls.int.test.ts`(全テーブルに RLS・持ち主でない・文脈が漏れない)・`tenant-isolation.int.test.ts`(2社)・E2E の `tenant-isolation.spec.ts` |
| 設計判断 | `docs/adr/0001-shared-tables-with-rls.md`・`docs/runbooks/tenant-data-leak.md` |

### 権限の表

| | どこ |
|---|---|
| 判断を1か所に・既定は拒否 | `apps/api/src/authz/policy.ts`(`ROUTE_RULES` に無い API は 403)・`middleware.ts` |
| 人が読む表 | `docs/authz/matrix.yaml`(他社は 404) |
| ① OpenAPI の全 API が表にあるか | `test/unit/authz-coverage.test.ts`(DB 不要・`pnpm test`) |
| ② 表の全行を各ロール+他社+未ログインで叩く | `test/integration/authz-matrix.int.test.ts` |
| AI が API を足すとき | `.claude/skills/add-api-endpoint/SKILL.md` |

### PR ごとのプレビュー環境

| | どこ |
|---|---|
| 流れ(開く → 立てる → E2E・ZAP → コメント / 閉じる → 消す) | `.github/workflows/preview.yml` |
| 毎晩の掃除 | `.github/workflows/cleanup-previews.yml` |
| PR ごとの ECS サービス+共有 ALB のルール(`pr-<番号>.preview.<domain>`) | `infra/terraform/modules/preview-env`・`envs/preview/pr` |
| 共有の土台(ALB・ワイルドカード証明書・VPC・ECR・役割) | `infra/terraform/envs/preview/base` |
| DB はコンテナの Postgres+種データ(本番の個人データは使わない) | `modules/preview-env/main.tf` の `db` / `setup` コンテナ |

### セキュリティの検査(security.md の 0)

| 対象 | 道具 | どこ |
|---|---|---|
| 自分のコード | Semgrep CE(公開のルール+自社ルール) | `ci.yml` の semgrep |
| 依存 | Trivy fs・Renovate | `ci.yml` の trivy-fs・`renovate.json` |
| 秘密情報 | gitleaks(全履歴) | `ci.yml` の gitleaks |
| イメージ | Trivy image | `ci.yml` の image |
| インフラ定義 | Trivy config・tflint | `ci.yml`・`terraform.yml` |
| 移行 | squawk | `ci.yml` の migrations |
| ワークフロー | actionlint・zizmor | `ci.yml` の workflows |
| 動いている画面 | ZAP ベースライン | `preview.yml` |
| 全 API に変な入力(ロールごと) | Schemathesis | `pnpm security:fuzz`・`security-fuzz.yml` |
| ログインした状態の API | ZAP API スキャン | `zap-api-scan.yml`(stg) |
| AWS の中 | WAF・GuardDuty・Security Hub | `infra/terraform/modules/waf`・`security-baseline` |

何を確かめていて何を確かめていないかの一覧と、深い診断の段取りは [docs/security.md](docs/security.md)。

---

## ✅ CI で回るもの

お金がかかりうるもの(AWS・Claude の API)は、**いまは手動だけ**にしてあります。有効にする手順と費用は [docs/guides/automation.md](docs/guides/automation.md)。

| ワークフロー | いつ | AWS / キーが無いとき |
|---|---|---|
| `ci.yml` | 自動: PR・main | 全部動く(AWS 不要) |
| `terraform.yml` | 自動: infra を変えた PR | fmt・validate・tflint・Trivy |
| `labeler.yml` | 自動: PR | 危険度のラベル |
| `terraform-plan.yml` | 手動 | 飛ばす(notice を出す) |
| `preview.yml` | 手動(PR の番号を入れる) | 飛ばす(notice を出す) |
| `cleanup-previews.yml` | 手動 | 飛ばす |
| `deploy.yml` | 手動 | 飛ばす |
| `claude.yml` | 手動(頼むことを書く) | 飛ばす(notice を出す) |
| `security-fuzz.yml` | 手動 | 動く(相手はジョブの中の compose) |
| `zap-api-scan.yml` | 手動 | 飛ばす(stg とスキャン用の利用者が要る) |

日々の進め方は [docs/playbook.md](docs/playbook.md)、Slack から頼む形にしたいときは [docs/guides/slack.md](docs/guides/slack.md)。

---

## 🙋 本人が手でやる設定

> 雛形を作っただけでは、AWS にもリポジトリの設定にも何も変えていない。下は人が判断して行う。

### 1. GitHub のリポジトリ設定

1. **ブランチ保護(main)**: Settings → Rules → Rulesets → New branch ruleset
   - 対象: `main`。「Require a pull request before merging」(承認 1、**危険度「高」は 2 にしたいので、チームができたら「Require review from Code Owners」+承認2**)
   - 「Require status checks to pass」: `Biome・型・単体`・`結合(Postgres・RLS・2社・権限の表 ②)`・`移行の検査(squawk)`・`E2E(docker compose+Playwright)`・`秘密情報(gitleaks)`・`コードの検査(Semgrep CE+自社ルール)`・`依存と設定(Trivy fs / config)`・`イメージのビルドと検査(Trivy image)`・`ワークフローの検査(actionlint・zizmor)`
   - 「Block force pushes」・「Require linear history」
2. **ラベル**を作る: `risk:high`・`risk:medium`・`risk:low`・`area:api`・`area:web`・`area:infra`・`kind:feature`・`kind:bug`・`needs-triage`・`dependencies`・`security`(labeler は無いラベルも作るが、色をそろえるなら先に)
3. **Environments**: `stg`(保護なし)と `prod`(**Required reviewers** に承認する人。「Prevent self-review」もオン)
4. **Renovate**: GitHub App の Renovate をこのリポジトリに入れる
5. **Secret scanning の push 保護**: 非公開のリポジトリでは有料(GitHub Advanced Security)。PMF 前は gitleaks で代える
6. **Actions の設定**: Settings → Actions → General → 「Fork pull request workflows」で、外の人の PR の実行に承認を必須にする

### 2. AWS アカウントと状態の置き場

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

### 3. OIDC の役割と GitHub の変数・秘密

Terraform の出力(`github_role_arns` など)を、Settings → Secrets and variables → Actions の **Variables** に入れる(秘密ではないので Variables):

| 変数 | 値 | 使うワークフロー |
|---|---|---|
| `TF_STATE_BUCKET` | 状態のバケット | terraform・preview・cleanup |
| `AWS_STG_PLAN_ROLE_ARN` / `AWS_PROD_PLAN_ROLE_ARN` | `<project>-<env>-plan` | terraform(plan) |
| `TF_VARS_STG` / `TF_VARS_PROD` | `*.auto.tfvars` の中身(秘密は入れない) | terraform(plan) |
| `AWS_PREVIEW_ROLE_ARN` | `preview-github` | preview・cleanup |
| `PREVIEW_ECR_REPOSITORY` / `PREVIEW_WEB_ECR_REPOSITORY` / `PREVIEW_DOMAIN` | preview/base の出力(API / 画面)/ `example.com` | preview |
| `AWS_STG_DEPLOY_ROLE_ARN` / `AWS_PROD_DEPLOY_ROLE_ARN` | `<project>-<env>-deploy` | deploy |
| `ECR_REPOSITORY_URL` / `WEB_ECR_REPOSITORY_URL` | stg の出力(API / 画面) | deploy |
| `MAIL_ECR_REPOSITORY_URL` | stg の出力 `mail_ecr_repository_url`(メールの中継) | deploy-mail-relay |
| `AWS_STG_COGNITO_CONTRACT_ROLE_ARN` / `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` | stg の出力(`github_role_arns` の `…-cognito-contract`・`cognito_user_pool_id`・`cognito_client_id`) | cognito-contract |
| `STG_URL` / `PROD_URL` | `https://app.stg.example.com` など | deploy(疎通) |
| `PROJECT` | 名前の頭(既定 `sfs`) | deploy |

**Secrets** に入れるのは1つだけ:

| 秘密 | 使うワークフロー |
|---|---|
| `ANTHROPIC_API_KEY` | claude(`@claude`)。Claude の GitHub App を入れて使う方法もある |

### 4. 見張りの知らせを Slack に流す

1. stg と prod の AWS アカウントそれぞれで、コンソールの「Amazon Q Developer in chat applications」(旧 AWS Chatbot)から Slack のワークスペースを許可する(ワークスペースの ID `T…` が分かる)
2. Slack に `#alerts-stg` と `#alerts-prod` を作り、チャンネルの ID(`C…`)を `*.auto.tfvars` の `slack_team_id` / `slack_channel_id` に入れて apply
3. 試しに鳴らして Slack に出るのを確かめる。月の上限(`monthly_budget_usd`)も見直す

手順・何を見張っているか・費用は [docs/guides/monitoring.md](docs/guides/monitoring.md)。鳴ったら [docs/runbooks/alarms.md](docs/runbooks/alarms.md)。

---

## 📏 わざとやっていないこと(次の一歩)

- **二段階認証の設定の画面・メールアドレスとパスワードの変更**: ログイン・登録・再設定の画面までは自前(ADR 0009)。設定の画面は次の PR。
- **メールの受け取らない設定・まとめ送り・HTML のメール**(spec 0002 の「やらないこと」)。
- **招待の画面**: いまは users に行を足すのは SQL(docs/runbooks/cognito-login.md)。
- **Cognito の独自ドメイン・パスキー**: いまは `<接頭辞>.auth.<region>.amazoncognito.com` とパスワード+TOTP。
- **サーバー側のセッション保存**: いまは署名つき Cookie。強制ログアウトが要るなら DB か Valkey に。
- **複数の組織に入る人**: いまは「1人 = 1組織」(ADR 0001)。
- **監査ログ・機能フラグ・OpenTelemetry のトレース・外からの死活の確認・当番**: ログには traceId を入れてあるので、トレースは後から足せる。
- **AI レビュー**(CodeRabbit / Claude の Code Review)と、危険度「低」の自動マージ: 見逃しを数えてから。
- **devcontainer の外への通信の制限**(AI の環境から出られる先を絞る)。
- **WAF**: ALB / CloudFront の前に。
- **画面の CSP(Content-Security-Policy)**: SSR が埋め込むスクリプトに nonce を付ける形が要る。いまは他の守りのヘッダー(`X-Frame-Options`・`nosniff` など)だけ。

## ⚠️ この雛形の注意

- `.claude/settings.json` の `ask` は、CI・認可・移行・infra のファイルを Claude Code が書くとき人の確認を求める(AI に勝手に変えさせない)。雛形を育てる間に邪魔なら `.claude/settings.local.json` で上書きできる。
- Windows では `pnpm test:integration` に Docker Desktop が要る。古い Docker Desktop で Testcontainers が待ち続けるときのため、ヘルスチェックだけで待つようにしてある(`test/integration/global-setup.ts`)。
