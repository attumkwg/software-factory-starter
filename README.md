# software-factory-starter

> 🚧 **作成中です。** 一通りそろったら MIT ライセンスで公開します。それまでは読む・参考にするのは自由ですが、コードの複製・改変・再配布はご遠慮ください。

AI エージェント前提でゼロから作るプロダクトの **動く雛形+設定一式**(TypeScript・AWS・Terraform・GitHub Actions)。

題材は小さな **マルチテナントの TODO アプリ**(組織 → プロジェクト → タスク。ロールは admin / member / viewer)。
中身より「ライン」(検査・権限の表・テナント分離・プレビュー環境・危険度で分けたレビュー・AI のハーネス)を見るための物です。

- ✅ 手元で動く: `docker compose up --build` で API+画面(SSR)+DB+ALB の代わり、`pnpm test` で単体、`pnpm test:integration` で本物の Postgres を使った結合テスト、`pnpm test:e2e` で画面の E2E。
- ✅ CI は **AWS も API キーも無しで緑**。AWS・Claude を使うジョブは、変数が無ければ失敗せずに飛ぶ。
- ⛔ AWS へのデプロイはしていない。Terraform は `fmt` と `validate` まで(apply は下の「本人がやる設定」のあと)。

📘 **はじめての人は [docs/getting-started.md](docs/getting-started.md)(使い始めの手引き)から**。なぜこう作るかは [docs/concepts/](docs/concepts/README.md)。docs 全体の地図は [docs/README.md](docs/README.md)。

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
│  ├─ designs/                  設計書のテンプレート(AI 用で網羅的に。AI の仮決めを追う「未確定事項」)
│  ├─ review-viewpoints.md      設計とレビューの観点(共通の8つ+このプロダクト特有。溜めていく)
│  ├─ adr/                      設計判断のテンプレートと例(共有の表+RLS・デザインシステム・SSR・領域・お金と時刻・アウトボックス・Cognito のログイン・メール・自前のログイン画面)
│  └─ runbooks/                 手順書の例(他社のデータが見えたかもしれない・Cognito でのログイン)
├─ infra/terraform/
│  ├─ modules/                  network・ecs-service(API+共有 ALB・blue/green)・web-service(画面の SSR)・mail-relay(Postfix+EFS)・ses-domain・aurora・backup(消せない保管庫)・alerts(SNS → Slack・費用の警報)・monitoring(アラーム)・uptime(外形監視)・preview-env・github-oidc
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

<!-- kit:readme:start -->
## 🧰 使い始めたらやること

> この節は [docs/kit/catalog.yaml](docs/kit/catalog.yaml)(部品のカタログ)から `pnpm kit:readme` で作る。手で直さない。

| # | やること | どうやって | 残る物 | 状態 |
|---|---|---|---|---|
| ① | 何を作るかを決める | `/kickoff`: 誰の困りごとか・いちばん危ない思い込み・確かめ方・合格と撤退の線を、1問ずつ決める | `docs/product/plan.md` | あり |
| ② | 部品を選ぶ | `/tailor`: 会社向けか・個人情報・お金・メール・検索・スマホ・認証の予定を聞き、部品ごとに「残す・消す」を決める。消す部品は1つずつ PR で | `docs/product/tailoring.md` | あり |
| ③ | 手でやる設定 | GitHub のブランチ保護・Environments・Renovate、AWS のアカウントと状態の置き場、Slack、バックアップの確かめ | [手順](#-本人が手でやる設定) | あり |
| ④ | 点検を立ち上げる | `pnpm checkup`: 台帳の使い始めた日(started_on)と担当者を自分のものにし、いまの段階でやること(守りが効いているか・取り返せない所)を出す。自動で確かめられる物は確かめ、毎週月曜の朝に GitHub の Issue で知らせる(急ぎは毎日)。人に聞くことは /checkup で1問ずつ答える | `docs/checkup/todo.yaml`・[手順](docs/checkup/README.md) | 作成中 |
| ⑤ | キットが既定で決めた所を決める | `pnpm decisions --adopt`: 設計書の未確定事項のうち、答えがプロダクトごとに違う物(導入時に決める)を出す。/tailor で設計書ごとに「既定のままでよいか」を答え、承認か変更にする。本番に出す前に pnpm decisions --launch が通ることを確かめる | `docs/designs/*.md`・[手順](docs/guides/human-review.md) | あり |

### 部品の一覧(`/tailor` で残す・消すを決める)

`/tailor` が聞くこと: 会社向け(B2B)か、個人向け(B2C)か/個人情報・要配慮個人情報(病歴・信条など)を扱うか/お金を扱うか(請求・決済・金額の計算)/利用者にメールを送るか/検索(Google など)から人を呼ぶか/スマホのアプリを作るか/認証(P マーク・ISMS・SOC 2)を取る予定があるか。

- 🔒 は土台。どの答えでも消さない。
- 既定は、迷ったときのおすすめ。**迷ったら残す**(消すのは後からでもできる。足し直すほうが高い)。
- 消す部品は1つずつ PR で(消し方はカタログの `remove`)。決めたことは `docs/product/tailoring.md` に残す。

| 区分 | 部品 | 何をするか | 既定 | 状態 |
|---|---|---|---|---|
| 土台(消さない) | 🔒 テナント分離と RLS `tenant-isolation` | 全部の表に tenant_id を持ち、DB の RLS とアプリの両方で、他社のデータを読めなくする | 残す | あり |
| 土台(消さない) | 🔒 組織と利用者・ロール `organizations` | 組織(テナント)と利用者、admin / member / viewer のロール | 残す | あり |
| 土台(消さない) | 🔒 認可の関所と権限の表 `authz` | 全部の API が1か所の関所を通り、表(matrix.yaml)に無い API は既定で拒否する。表の全行をテストで叩く | 残す | あり |
| 土台(消さない) | 🔒 自前のログイン画面と Cognito `login` | 自前の画面 → API → Cognito でログイン・登録・パスワードの再設定。トークンはサーバーの中だけ。手元とテストは偽物の Cognito | 残す | あり |
| 土台(消さない) | 🔒 秘密の扱い `secrets` | 秘密は Secrets Manager と GitHub の Environment にだけ置く。gitleaks で全履歴を見る。漏れたときの手順書 | 残す | あり |
| 土台(消さない) | 🔒 バックアップと戻す訓練 `backup` | 消せない保管庫に毎日と毎月。毎月 stg で戻す訓練 | 残す | あり |
| 土台(消さない) | 🔒 CI の検査 `ci-checks` | 型・lint・単体・結合(2社)・E2E・API の互換・移行(squawk)・Semgrep・Trivy・gitleaks・ワークフローの検査・未確定事項の仮決め(decisions --strict)・ADR の番号の重なり | 残す | あり |
| 土台(消さない) | 🔒 ログの決まり `logging` | 構造化ログ・request ID・必要な項目だけを残す(オブジェクトを丸ごと渡さない) | 残す | あり |
| 土台(消さない) | 🔒 ログの許可リスト(出してよい項目だけ) `log-allowlist` | ログに出してよい項目を決めておき、それ以外は落とす。全部の API を目印つきの値で叩き、個人情報がログに出ないことをテストで確かめる | 残す | 作成中(PR #10) |
| 土台(消さない) | 🔒 AI のハーネス(守りの一覧とフック) `harness` | 危険度「高」の場所は AI が人の確認なしに変えない。Bash のフック・CODEOWNERS・ラベルと一覧をそろえる | 残す | あり |
| 土台(消さない) | 🔒 列の分類表とログ `column-classification` | 全部の列に「個人情報か」と目的を書き、要配慮は分けて置くまで足せないようにする。台帳(docs/db/personal-data.md)はここから作る | 残す | あり |
| 会社向け | 監査ログ `audit-log` | 誰が・いつ・何をしたかを残し、お客さんの管理者が画面で見られる。書き込みの API は関所が自動で残す | 残す | あり |
| 会社向け | サポートの代理ログイン `support-access` | お客さんの管理者が許可した間だけ、運営の社員がその組織の画面を「見るだけ」で開ける | 残す | あり |
| 会社向け | 解約(書き出しと削除) `offboarding` | 管理者が自社のデータを書き出せる。解約した組織を、試し → 名前の確認つきで丸ごと消すコマンド | 残す | あり |
| 会社向け | 組織ごとの二段階認証の必須化 `mfa-required` | 組織の管理者が「全員に二段階認証を必須にする」を選べる | 残す | あり |
| 会社向け | 招待の画面 `invitations` | 管理者が画面から人を招く(いまは SQL で users に行を足す) | 残す | 未 |
| ログイン | 二段階認証(本人の設定) `mfa` | 認証アプリ(TOTP)の設定と解除・メールとパスワードの変更のお知らせ | 残す | あり |
| 連絡 | アウトボックス(送り待ち) `outbox` | 外へ送るもの(メール・Slack・索引)を DB のトランザクションと一緒に積み、あとで確実に送る | 残す | あり |
| 連絡 | アプリからのメール(Postfix → SES) `mail` | タスクの完了・パスワードや二段階認証の変更のお知らせを送る。本番は Postfix(ECS)→ SES、手元は Mailpit | 残す | あり |
| 見張り | Sentry(失敗の知らせ) `sentry` | error 以上のログを、値を落としてから Sentry に送る(API・画面のサーバー・ブラウザ) | 残す | あり |
| 見張り | アラームと知らせ・費用の警報 `alarms` | 5xx・遅さ・DB・証明書のアラーム、月の費用の警報を SNS → Slack(とメール)へ | 残す | あり |
| 見張り | 外形監視 `uptime` | 外から本番が開けるかを Route 53 のヘルスチェックで見る | 残す | あり |
| 見張り | WAF `waf` | ALB の前で、よくある攻撃の形と大量アクセスを数える(誤検知が無ければ止める) | 残す | あり |
| 見張り | GuardDuty と Security Hub `security-baseline` | AWS の中の怪しい動き(鍵の悪用・知らない場所からの操作)と、設定の穴を見つけて知らせる | 残す | あり |
| 表側(画面) | 画面(SSR)とデザインシステム `web` | TanStack Start の SSR の画面と、React Aria の部品(packages/ui)。API とは別のサービス | 残す | あり |
| 表側(画面) | 検索に載せない(noindex)とスマホの幅の E2E `noindex-mobile` | 本番以外と、ログインの後の画面を検索に載せない(X-Robots-Tag・robots.txt)。スマホの幅で画面がはみ出さないかを E2E で見る | 残す | あり |
| 表側(画面) | 公開のページと SEO の型 `seo` | 検索から人を呼ぶための公開のページ(説明・料金・ブログ)の型 | 消す | 未 |
| 個人情報 | 個人データが漏れたときの手順書 `breach-runbook` | 委員会への報告(速報3〜5日・確報30日 / 60日)と本人への通知、B2B のお客さんへの知らせの段取り | 残す | あり |
| 個人情報 | 要配慮個人情報を分けて置く `sensitive-isolation` | 病歴・信条などの要配慮個人情報を、分けた場所(スキーマ sensitive・別の鍵)にだけ置く(ADR 0018 の段1から)。分けるまで列を足せない守りは、土台の列の分類表に入っている | 消す | 未 |
| 個人情報 | 1人分の削除と開示 `person-deletion` | 利用者1人の「自分のデータを見せて・消して」に答える(組織の丸ごとの削除とは別) | 残す | 未 |
| 決まりごと | 利用規約・プライバシーポリシーの同意 `terms-consent` | 規約の版を持ち、重要な変更は次のログインで同意し直すまで使えなくする。登録の画面での同意・変更のお知らせのメール(運営のコマンド legal-notify)も。同意の記録は監査ログに | 残す | あり |
| 決まりごと | 認証の準備(P マーク・ISMS・SOC 2) `certification-prep` | 認証で求められる記録と規程の型(アクセスの見直し・委託先の管理・教育の記録) | 消す | 未 |
| 決まりごと | 請求と決済 `billing` | 料金の計算・請求・決済の会社(Stripe など)とのつなぎ。カード情報は持たない | 消す | 未 |
| 決まりごと | お金と時刻の計算 `money` | 金額は最小単位の整数・時刻は組織のタイムゾーン、の計算を1か所に(packages/shared の money.ts・time.ts) | 残す | あり |
| 開発の道具 | PR ごとのプレビュー環境 `preview-env` | PR ごとに dev の AWS に環境を立て、E2E と ZAP を流し、閉じたら消す | 残す | あり |
| 開発の道具 | GitHub の上の Claude(背景エージェント) `claude-actions` | Issue と PR の @claude で、GitHub の上で Claude が作業する(いまは手動。API キーが要る) | 残す | あり |
| 開発の道具 | 攻撃の形の検査(Schemathesis・ZAP) `dynamic-scans` | 全部の API に変な入力をロールごとに投げる・動いている画面と API を ZAP で叩く(手動) | 残す | あり |
| 開発の道具 | 脆弱性の精査と対応方針(/cve) `cve-triage` | Dependabot の通知・Trivy・OSV・基盤と主な依存の発表を集め、関係あるかを6段で精査し、期限つきの直し方を決める。記録(docs/security/vulns.md)と通知の突き合わせは pnpm vulns | 残す | あり |
| 開発の道具 | プロトタイプの置き場 `prototypes` | 本番のラインに乗せずに、押せる画面だけ・偽のデータの試作を作り(/prototype)、合言葉つきの URL で見せる(S3+CloudFront) | 残す | あり |
| 進め方 | 始め方の計画(/kickoff) `kickoff` | 誰の困りごとか・いちばん危ない思い込み・確かめ方・合格と撤退の線を、1問ずつ決めて計画にする | 残す | あり |
| 進め方 | 機能ごとの賭け(/bet) `bets` | 機能ごとに「何を賭けて・何が分かったら続けるか」を先に書き、小さく確かめながら進める。PR の本文に取り組みと作業の種類を書く | 残す | あり |
| 進め方 | 組織ごとの機能フラグ `feature-flags` | 賭けの psf / rollout で、運営が選んだ組織にだけ機能を出す・止める(定義はコード・組織ごとの状態は DB・切り替えは運営のコマンド)。A/B テストの土台 | 残す | あり |
| 進め方 | 利用の記録 `usage-records` | どの組織の・誰が・どの機能を・どの日に使ったかを1日1人1行で残し、運営が週ごとの数(組織と人の ID は出さない)を出す。賭けの rollout の線を測る。中身・時刻・URL・IP は残さず、400日で消す | 残す | あり |
| 進め方 | 資産と費用の台帳(/ledger) `ledger` | 作った物(資産)とかかったお金を1つの台帳にする | 残す | 未 |
| 進め方 | 点検(/checkup) `checkup` | 段階ごと・毎週の点検を台帳(docs/checkup/todo.yaml)にし、pnpm checkup が使い始めた日からの段階に当たる項目を出して自動で確かめられる物を確かめる。人に聞くことは /checkup が1問ずつ聞き、答えを台帳に書いて PR にする。担当者には毎週月曜 8:00 に Issue で知らせ、急ぎは毎日 8:00 に1件ずつ(checkup.yml) | 残す | 作成中(PR #18) |
<!-- kit:readme:end -->

---

## 🧭 考え方とこの雛形の対応

考え方の本体(7工程・ハーネス3層・段階と費用・人と AI の分担・長く回す)は [docs/concepts/](docs/concepts/README.md)、セキュリティの決まり(AI ならではの守り・認可・テナント分離)は [docs/security.md](docs/security.md)。ここでは、それがこの雛形のどのファイルに当たるかを並べる。

### 7工程

| 工程 | この雛形のどこ |
|---|---|
| ① 受付 | `.github/ISSUE_TEMPLATE/`(機能・不具合。不具合には requestId の欄) |
| ② 振り分け | Issue の危険度の見込み・`needs-triage` ラベル |
| ③ 仕様 | `docs/specs/`(受け入れ条件・権限の表の行・STRIDE)・`docs/designs/`(設計書と未確定事項。`/design`)・`docs/adr/` |
| ④ 実装 | `CLAUDE.md`・`.claude/skills/`・`.github/workflows/claude.yml`(`@claude`) |
| ⑤ 検証 | `ci.yml`(型・lint・単体・結合・E2E・検査)・`preview.yml`(PR ごとの環境で E2E と ZAP) |
| ⑥ レビュー | `pull_request_template.md`(全体像と判断してほしい所を一番上。問いは「事実・理由・問い」)・`docs/review-viewpoints.md`(観点ごとの扱い)・`CODEOWNERS`・`labeler.yml`。直しは `/rework`(上流から作り直す)。考え方は `docs/guides/human-review.md` |
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
| ① 手元の Claude Code | `CLAUDE.md`(全体・api・web)・`.claude/settings.json` のフック(書いたら Biome・終わる前に型と影響範囲のテスト。2回落ちたら人へ)・`.claude/skills/`(API を足す / DB の移行 / 設計 / 作り直し / リリースノート / 脆弱性の精査 `/cve`)・`.devcontainer/` |
| ② 背景エージェント | `.github/workflows/claude.yml`(Issue / PR の `@claude`。起動できるのはリポジトリの持ち主 OWNER だけ。[docs/security.md の AI-3](docs/security.md)) |
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

### セキュリティの検査(docs/security.md の「毎回の検査」)

| 対象 | 道具 | どこ |
|---|---|---|
| 自分のコード | Semgrep CE(公開のルール+自社ルール) | `ci.yml` の semgrep |
| 依存 | Trivy fs・Renovate・Dependabot alerts・精査と対応方針(`/cve`) | `ci.yml` の trivy-fs・`vuln-scan.yml`(定期)・`renovate.json`・`pnpm vulns`([docs/guides/vulnerabilities.md](docs/guides/vulnerabilities.md)) |
| 秘密情報 | gitleaks(全履歴) | `ci.yml` の gitleaks |
| イメージ | Trivy image | `ci.yml` の image |
| インフラ定義 | Trivy config・tflint | `ci.yml`・`terraform.yml` |
| 移行 | squawk | `ci.yml` の migrations |
| ワークフロー | actionlint・zizmor(PR ごとはオフライン。定期はオンライン) | `ci.yml` の workflows・`vuln-scan.yml` |
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
| `terraform-plan.yml` | 手動(PR の plan は stg だけ。prod は main のときだけ) | 飛ばす(notice を出す) |
| `preview.yml` | 手動(PR の番号を入れる) | 飛ばす(notice を出す) |
| `cleanup-previews.yml` | 手動 | 飛ばす |
| `deploy.yml` | 手動 | 飛ばす |
| `claude.yml` | 手動(頼むことを書く) | 飛ばす(notice を出す) |
| `security-fuzz.yml` | 手動 | 動く(相手はジョブの中の compose) |
| `zap-api-scan.yml` | 手動 | 飛ばす(stg とスキャン用の利用者が要る) |
| `vuln-scan.yml` | 自動: 毎週月曜 5:00・手動でも(定期の脆弱性チェック。Trivy fs と zizmor のオンライン版。落ちたら Issue → `/cve`) | 動く(AWS も秘密も要らない) |

`ci.yml` は、画面の JS の大きさ・関数の複雑さとファイルの長さ・テストのカバレッジにも上限を持つ(超えると落ちる)。値と根拠は [docs/guides/ci-limits.md](docs/guides/ci-limits.md)。

日々の進め方は [docs/playbook.md](docs/playbook.md)、Slack から頼む形にしたいときは [docs/guides/slack.md](docs/guides/slack.md)。

---

## 🙋 本人が手でやる設定

> 雛形を作っただけでは、AWS にもリポジトリの設定にも何も変えていない。下は人が判断して行う。

### 1. GitHub のリポジトリ設定

> 🧍 **1人の間**と 👥 **人が増えたら**(レビューできる人が2人以上)で変わる所は、両方を書いた。人が増えたら 🧍 の所を 👥 に切り替える。
>
> 🌐 **公開か非公開か**でも使える物が変わる。非公開+Free では 1 と 3 ができない(表は [docs/guides/local-guards.md](docs/guides/local-guards.md))。

1. **ブランチ保護(main)**: Settings → Rules → Rulesets → New branch ruleset
   - 対象: `main`(Include default branch)。**Bypass list は空**(持ち主も例外にしない)
   - 「Require a pull request before merging」
     - 🧍 1人の間: **Required approvals は 0**。GitHub では自分の PR を自分で承認できず、AI の PR も自分のアカウントで出るので、1 にすると全部の PR が止まる。人の目の代わりに、必須のチェック(下)と手元の守り([docs/guides/local-guards.md](docs/guides/local-guards.md))で止める
     - 👥 人が増えたら: 承認 1・「Require review from Code Owners」・「Dismiss stale pull request approvals when new commits are pushed」をオン。危険度「高」を2人にするなら、`.github/CODEOWNERS` の「高」の行に2つのチームを並べて承認 2 にする
   - 「Require status checks to pass」と「Require branches to be up to date before merging」(並べて出した PR が、合わさって main を赤くするのを防ぐ): `Biome・型・単体`・`結合(Postgres・RLS・2社・権限の表 ②)`・`API の互換(oasdiff。項目は足すだけ)`・`移行の検査(squawk)`・`E2E(docker compose+Playwright)`・`秘密情報(gitleaks)`・`コードの検査(Semgrep CE+自社ルール)`・`依存と設定(Trivy fs / config)`・`イメージのビルドと検査(Trivy image・api)`・`イメージのビルドと検査(Trivy image・web)`・`イメージのビルドと検査(Trivy image・mail)`・`ワークフローの検査(actionlint・zizmor)`・`取り組みと作業の種類(PR の本文)`(PR の本文の「🎯 取り組み」。マージキューを使うなら、キューの中では流れないのでここから外す)
   - 「Restrict deletions」・「Block force pushes」・「Require linear history」
   - ⚠️ 「Require linear history」にすると、**マージは Squash か Rebase だけ**になる(「Create a merge commit」は使えない)。Settings → General → Pull Requests で「Allow merge commits」をオフにしておくと、ボタンで迷わない
2. **ラベル**を作る: `risk:high`・`risk:medium`・`risk:low`・`area:api`・`area:web`・`area:infra`・`kind:feature`・`kind:bug`・`needs-triage`・`dependencies`・`security`(labeler は無いラベルも作るが、色をそろえるなら先に)
3. **Environments**(Settings → Environments)。**どれも「Deployment branches and tags」を「Selected branches and tags」にして `main` だけを足す**。ワークフローの中でも main 以外は飛ばすが、ブランチのワークフローは書き換えられるので、GitHub の側でも止める(これが本当の守り):
   - `stg`(承認なし)と `prod`(**Required reviewers** に承認する人)。deploy・deploy-mail-relay が使う。main 以外のブランチを stg に出せると、prod は stg のイメージを引くので、承認1回でレビューされていないコードが本番に出てしまう
     - 🧍 1人の間: prod の承認する人は自分。**「Prevent self-review」はオフ**(オンだと、自分でマージしたデプロイを誰も承認できない)。承認は「本番に出す前に一度止まって見る」ための一手間として使う
     - 👥 人が増えたら: 承認する人を2人以上にして「Prevent self-review」をオン(マージした本人が本番を通せないように)
     - 🔒 非公開のリポジトリでは、Pro / Team でも承認する人を置けない(公開か Enterprise だけ)
   - `claude`: 秘密 `ANTHROPIC_API_KEY` を**ここに**置く(下の 3. の表)。claude.yml が使う
   - `zap`: 秘密 `ZAP_SCAN_USERNAME`・`ZAP_SCAN_PASSWORD` を**ここに**置く。zap-api-scan.yml が使う
4. **Renovate**: https://github.com/apps/renovate → Install(入っていれば Configure)→ 自分のアカウント → 「Only select repositories」でこのリポジトリだけ → Install。Mend の画面に移ったら GitHub でサインインして規約に同意する
   - `renovate.json` があるので、最初の設定の PR は出ずにそのまま動く。更新の PR は毎週月曜の朝9時前に最大5本(出てから3日たった版だけ)。脆弱性の直しはいつでも。自動マージはしない
   - 大きい版は PR にならず、Dependency Dashboard の Issue の「Pending Approval」に並ぶ。上げるときにチェックを入れる(Node と Postgres は PR の本文の ⚠️ のとおり、Renovate が読めない所も同じ PR で直す)
   - Mend の画面(https://developer.mend.io)でリポジトリの Mode が「Silent」だと、動いても PR も Dependency Dashboard も出ない。入れた後に Dashboard の Issue が出なければ、Settings で Silent を外す
5. **Secret scanning と push 保護**(秘密を含む push をその場で止める)
   - 🌐 公開: **無料**。Settings → Advanced Security で「Secret Protection」(Secret scanning)と「Push protection」をオンにする。CI の gitleaks も外さない(履歴の全部を毎回見る・`.gitleaksignore` で理由つきに除外できる)
   - 🔒 非公開: 有料(GitHub Secret Protection)。PMF 前は CI の gitleaks で代える
6. **Actions の設定**: Settings → Actions → General
   - 「Approval for running fork pull request workflows from contributors」を **Require approval for all external contributors** にする(外の人の PR の実行は、毎回人が中身を見てから。公開だと誰でも PR を出せる)
   - 「Workflow permissions」を **Read repository contents and packages permissions**(読み取りだけ)にする。書き込みが要るワークフローは、ファイルの中で `permissions:` を1つずつ足してある
   - 「Allow GitHub Actions to create and approve pull requests」を**オフ**にする(AI や Actions が自分の PR を承認できないように)
   - 「Artifact and log retention」を**7日**にする(ZAP のレポートは `zaproxy/action-api-scan` が成果物を作るので、ワークフローから日数を決められない。レポートにはリクエストの中身が入りうる)
7. **Dependabot alerts**: Settings → Advanced Security(または Code security)→ 「Dependabot alerts」を有効にする(依存の脆弱性の知らせ。直す PR は Renovate が出すので、Dependabot の security updates はオフのままでよい)
   - 🌐 公開なら「Private vulnerability reporting」もオンにする(外の人が脆弱性を Issue に書かずに、非公開で知らせられる)
8. **プレビューは dev アカウントだけ**: PR のプレビューが引く AWS の役割(`AWS_PREVIEW_ROLE_ARN`)は、PR の版のワークフローからも引ける(OIDC の `pull_request`)ので、PR を書ける人なら dev の中で動かせる。dev には**本物の秘密・本物のデータを置かない**(プレビューの DB はコンテナの Postgres+種データ)。prod の役割は PR から引けない

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
| `PROJECT` | 名前の頭(既定 `sfs`) | deploy |

**Secrets** は、リポジトリ全体(Repository secrets)には置かず、**使う Environment の秘密**(Settings → Environments → 名前 → Environment secrets)に置く。Environment は main だけに絞ってあるので(上の 1. の 3)、PR のブランチのワークフローからは読めない:

| 秘密 | 置く Environment | 使うワークフロー |
|---|---|---|
| `ANTHROPIC_API_KEY` | `claude` | claude(`@claude`)。Claude の GitHub App を入れて使う方法もある |
| `ZAP_SCAN_USERNAME`・`ZAP_SCAN_PASSWORD` | `zap` | zap-api-scan(stg のスキャン用の利用者) |

すでに Repository secrets に入れていたら、Environment に入れ直してから Repository secrets の方を消す。

### 4. 見張りの知らせを Slack に流す

1. stg と prod の AWS アカウントそれぞれで、コンソールの「Amazon Q Developer in chat applications」(旧 AWS Chatbot)から Slack のワークスペースを許可する(ワークスペースの ID `T…` が分かる)
2. Slack に `#alerts-stg` と `#alerts-prod` を作り、チャンネルの ID(`C…`)を `*.auto.tfvars` の `slack_team_id` / `slack_channel_id` に入れて apply
3. 試しに鳴らして Slack に出るのを確かめる。月の上限(`monthly_budget_usd`)も見直す

### 5. バックアップ(prod は3日のうちに確かめる)

prod のバックアップの保管庫は **compliance のロック**で、apply から3日を過ぎると、ロックも保存の期間も誰にも変えられない(root でも)。**3日のうちに**、保管庫・毎日 35日・毎月 365日・1回目のバックアップが取れたこと、を確かめる([docs/runbooks/db-restore.md](docs/runbooks/db-restore.md) の 6)。prod の戻す訓練は四半期に1回、手で(同じ手順書の 5)。

### 6. サポートの代理ログイン(運営の組織)

社員がお客さんの画面を見るのは、お客さんの管理者が許可した間だけ・見るだけ(docs/specs/0004-support-access.md)。本番の DB に「運営の組織」と社員を1回だけ作り、その ID を `*.auto.tfvars` の `support_tenant_id` に入れて apply する。手順は [docs/runbooks/support-access.md](docs/runbooks/support-access.md)。手元とプレビューは種データの `support@ops.test` で試せる。

手順・何を見張っているか・費用は [docs/guides/monitoring.md](docs/guides/monitoring.md)。鳴ったら [docs/runbooks/alarms.md](docs/runbooks/alarms.md)、Sentry に来たら [docs/runbooks/sentry.md](docs/runbooks/sentry.md)。

---

## 📏 わざとやっていないこと(次の一歩)

- **二段階認証の予備のコード・管理者が人の二段階認証を外す画面**: 二段階認証の設定・メールアドレスとパスワードの変更・組織の必須は画面「アカウント」と「設定」にある(docs/specs/0006-account-security.md)。認証アプリを無くした人は、運営が手順書で戻す([docs/runbooks/mfa-reset.md](docs/runbooks/mfa-reset.md))。
- **メールの受け取らない設定・まとめ送り・HTML のメール**(spec 0002 の「やらないこと」)。
- **招待の画面**: いまは users に行を足すのは SQL(docs/runbooks/cognito-login.md)。
- **Cognito の独自ドメイン・パスキー**: いまは `<接頭辞>.auth.<region>.amazoncognito.com` とパスワード+TOTP。
- **サーバー側のセッション保存**: 作らない(ADR 0017)。署名つき Cookie で、無操作1時間・ログインから最長12時間で切れる。端末を選んで切る・管理者による強制ログアウトが要るようになったら DB か Valkey に。
- **複数の組織に入る人**: いまは「1人 = 1組織」(ADR 0001)。
- **監査ログの「読んだ」記録・消せない S3 への写し・OpenTelemetry のトレース・本物のブラウザでの外形監視(Synthetics)・当番**: ログには traceId を入れてあるので、トレースは後から足せる。
- **AI レビュー**(CodeRabbit / Claude の Code Review)と、危険度「低」の自動マージ: 見逃しを数えてから。
- **devcontainer の外への通信の制限**(AI の環境から出られる先を絞る)。
- **WAF を「止める」にすること**: stg・prod の ALB の前に WAF はある(`infra/terraform/modules/waf`)が、入れたばかりは「数えるだけ(count)」。誤検知が無いのを確かめてから `mode = "block"` に([docs/security.md](docs/security.md))。
- **画面の CSP(Content-Security-Policy)**: SSR が埋め込むスクリプトに nonce を付ける形が要る。いまは他の守りのヘッダー(`X-Frame-Options`・`nosniff` など)だけ。

## ⚠️ この雛形の注意

- `.claude/settings.json` の `ask` は、CI・認可・移行・infra のファイルを Claude Code が書くとき人の確認を求める(AI に勝手に変えさせない)。雛形を育てる間に邪魔なら `.claude/settings.local.json` で上書きできる。
- Windows では `pnpm test:integration` に Docker Desktop が要る。古い Docker Desktop で Testcontainers が待ち続けるときのため、ヘルスチェックだけで待つようにしてある(`test/integration/global-setup.ts`)。
