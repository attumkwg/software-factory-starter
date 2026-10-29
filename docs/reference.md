# キットの中身の早見表(リファレンス)

> 2026-10-25 にルートの README から移した(README は使い始める人向けの入口にした)。中身は変えていない。
> ファイルの地図・手元のコマンドの全部・考え方とファイルの対応・CI で回る物・わざとやっていないこと・注意。AI が「どこに何があるか」を探すときもここから。
> 手でやる設定(GitHub・AWS・OIDC の変数・Slack・バックアップ・運営の組織)は [guides/manual-setup.md](guides/manual-setup.md)。docs 全体の地図は [README.md](README.md)。

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
│  ├─ web/                      TanStack Start の SSR(ログイン → プロジェクト → タスク)と Playwright の E2E
│  │  ├─ src/routes/            画面と URL(ファイルの置き場所が URL になる)。loader が SSR でデータを読む
│  │  ├─ src/pages/             画面の中身(@app/ui の部品だけ)
│  │  ├─ src/api.ts             API の呼び出し(ブラウザからは /api、SSR からは API_INTERNAL_URL)
│  │  ├─ server/                本番の Node サーバー(静的ファイル・/readyz・SSR への受け渡し)
│  │  └─ Dockerfile             distroless・1つにまとめた JS だけ(node_modules も秘密も無い)
│  └─ site/                     公開の LP(静的。ビルドのときにページごとの HTML を作る。本番だけ検索に載る。docs/guides/landing-page.md)
│     ├─ src/content.ts         LP の言葉(架空の見本。docs/product/positioning.md から写す)
│     ├─ src/pages/             LP・確認・取り消しのページ(@app/ui の部品だけ)
│     └─ scripts/prerender.mjs  ページごとの HTML・robots.txt・sitemap.xml を作る
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
│  ├─ legal/                    お客さんに出す取り決めの型(申込書・SLA・個人データの取り扱い。文面は書かず、既定・根拠・使う人が決めること)
│  ├─ adr/                      設計判断のテンプレートと例(共有の表+RLS・デザインシステム・SSR・領域・お金と時刻・アウトボックス・Cognito のログイン・メール・自前のログイン画面)
│  ├─ runbooks/                 手順書の例(他社のデータが見えたかもしれない・Cognito でのログイン)
│  └─ kit/                      キットの持ち物(部品のカタログ catalog.yaml・保守の方針 maintenance.md・取り込んだ版 upstream.yaml・取り込みの手引き upgrade.md・最初の1週間 first-week.md・用語集 glossary.md・経営者と情シス向けの1枚 one-pager.md)
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
├─ .devcontainer/               人も AI も同じ開発環境(外への通信は許可リストのプロキシだけ。egress/。docs/guides/unattended-ai.md)
├─ CLAUDE.md                    どこを触っても守るルール(場所ごとのルールは apps/api・apps/web・packages・infra・.github・docs の CLAUDE.md)
├─ CHANGELOG.md / SECURITY.md   キットの版ごとの変更 / 穴の知らせ方(キットから作ったら自分の物に。docs/kit/maintenance.md)
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

画面の見た目を前と比べる(VRT。ブラウザは Docker の中。画面を変えたら `pnpm vrt:update` で撮り直す。[docs/guides/vrt.md](guides/vrt.md)):

```bash
docker compose -f docker-compose.vrt.yml up -d --wait
```

```bash
pnpm vrt
```

色のトークンのコントラストの比(明るいテーマと暗いテーマ。WCAG 2.2 AA。色の案を出すときは `/brand` が案のファイルを並べて渡す。[docs/design-system.md](design-system.md)):

```bash
pnpm contrast
```

開発するとき(API は 3000、画面は 5173。画面は SSR のまま自動で読み直し、/api は API へ中継する):

```bash
docker compose up -d db
```

```bash
cp apps/api/.env.example apps/api/.env && pnpm db:migrate && pnpm db:seed && pnpm dev
```

種データは **必ず2社**: Acme(`admin@acme.test` / `member@acme.test` / `viewer@acme.test`)と Globex(`admin@globex.test`)。

その他: `pnpm lint`(Biome)・`pnpm typecheck`・`pnpm metrics`(週の数字。gh で読むだけ。[docs/guides/metrics.md](guides/metrics.md))・`pnpm openapi`(apps/api/openapi.json を書き出す)・`pnpm --filter @app/api db:lint`(squawk)。


---

## 🧰 コマンドの全部

> ルートの `CLAUDE.md` から移した(AI が毎回読む量を減らすため。よく使う物だけルートに残した)。コマンドを足したらここに1行。

- `pnpm install` / `pnpm dev`(API 3000 + 画面 5173。先に `docker compose up -d db && pnpm db:migrate && pnpm db:seed`)
- `pnpm lint`(Biome。複雑さ・長さの上限も)/ `pnpm typecheck` / `pnpm test`(単体)/ `pnpm test:coverage`(カバレッジの下限。API は単体+結合で見るので Docker が要る。`docs/guides/ci-limits.md`)/ `pnpm test:integration`(Docker が要る)
- `pnpm test:e2e`(`docker compose up --build -d` のあとで。http://localhost:8080 = ALB の代わり)
- `pnpm vrt`(見た目の回帰テスト。先に `docker compose -f docker-compose.vrt.yml up -d --wait` で Docker の中のブラウザも)/ `pnpm vrt:update`(画面を変えたときだけ。撮り直した画像を見てからコミット)。`docs/guides/vrt.md`
- 影響範囲だけ: `pnpm turbo run typecheck test --filter=...[HEAD]`
- `pnpm kpi`(KPI の木の一覧と確かめ。記録の古さ・合議の見込みの当たり外れ・合議の星も出す。ペルソナの7つの立場の地図と合議の記録の形も見る。北極星・入力・守りの最新の値と線。形・番号・ペルソナ・測り方の誤りと、金額をリポジトリに書いたら落ちる。`docs/guides/kpi.md`・仕様 0081)
- `pnpm pr:merge-when-green <番号> --reply "<持ち主の返事>" --answered-at <答えた日時>`(1人の間・持ち主が `KIT_AI_MERGE=slack` を入れた所だけ。返事の言葉と日時を PR に残し、必須のチェックが全部緑になってから AI がマージする。危険度「高」も。`/slack-request`・仕様 0080・0085)。`--reply` の代わりに `--sensors` で、人を呼ぶ理由の無い PR を返事なしで入れる(`setup.yml` の `ai_merge.sensors_only: true` の所だけ。ADR 0094)。main にマージキューがあれば、マージせずにキューに並べる
- `pnpm progress`(依頼ごとの進み具合: 親 Issue ごとの n/m・次に進められる子・待つ子・止まった PR・完成の判定と、依頼から届くまでの日数。`--write` で親 Issue の本文を直す・毎朝と子が閉じたとき `progress.yml`。仕様 0086)
- `pnpm queue`(人の判断待ちを古い順に。`--issue` で「🧑‍⚖️ 判断待ち」の Issue を直す・毎朝 `human-queue.yml`。`docs/concepts/human-decisions.md`)
- `pnpm guards`(危険度「高」の守りが一覧とそろっているか+Bash のフックのテスト)/ `pnpm outbound`(AI が外へ向けてした操作の記録を、PR の「🚪 外へ出した物」の表にする。`--clear` で空に。`docs/designs/0057-ai-egress.md`)
- `pnpm setup:github`(GitHub の設定を `.github/setup.yml`・`.github/labels.yml` にそろえる。既定は試しで差分だけ・`--apply` で反映。**人が打つ**(AI は試しまで))/ `pnpm setup:check`(使うラベル・必須のチェック・Environment・定期の見分け・ラベルの手引きが設定ファイルとずれていないか。CI)/ `pnpm setup:labels`(ラベルの手引き `docs/guides/labels.md` を作り直す)。`docs/guides/github-setup.md`
- `pnpm vendors`(委託先の台帳 `docs/compliance/vendors.yaml` とコードの照らし合わせ。CI)/ `pnpm vendors --write`(人が読む一覧 `vendors.md` を作り直す)
- `pnpm vulns`(Dependabot の開いている通知のうち精査していない物・見直す日が来た記録。`gh` を使う)
- `pnpm self-contained`(キットの外の資料を指していないか。根拠は `docs/concepts/` と `docs/security.md` の番号つきの決まりを指す)
- `pnpm gaps`(穴の一覧 `docs/scenarios/gaps.md` の今の数(全部と段ごと)・行の形・済みの行の仕様の状態・段の抜け・済んだ穴を「穴」と書いた文書。CI。`--write` で頭の「今の数」の表を作り直す。`docs/designs/0078-gaps-watch.md`)
- `pnpm checkup`(点検の台帳 `docs/checkup/todo.yaml` から、いまの段階に当たる項目を出し、自動で確かめられる物を確かめる。`gh` を使う。台帳を直したら `--write-readme`。答えは `/checkup` が `pnpm checkup:answer` で書く。キットから作ったら一度 `pnpm checkup:adopt --by @自分`。`--issue`・`--urgent` は知らせ(`checkup.yml` が毎週・毎日流す。手元では打たない))
- `pnpm contrast`(色のトークンのコントラストの比。明るいテーマと暗いテーマ・WCAG 2.2 AA。案のファイルを並べて渡すと比べられる)
- `pnpm sales:pack --out <ファイル>`(稟議の資料の束: 仕組みの事実・SLA・取り扱い・委託先を1つに。リポジトリの外に書く。デモの組織は stg でデモの前に手で戻す `demo-reset.yml`。`docs/guides/sales.md`)
- `pnpm metrics`(週の数字: DORA の4つ・AI が手伝った PR の割合・人の介在率・仕様の在庫。決裁用と改善用。`gh` で読むだけ。`metrics.yml` が毎週。`docs/guides/metrics.md`)
- `pnpm prototypes`(試作が本物と混ざっていないか)/ `pnpm prototype:dev <賭けの ID>`(試作を手元で開く)

## 🧭 考え方とこの雛形の対応

考え方の本体(7工程・ハーネス3層・段階と費用・人と AI の分担・長く回す)は [docs/concepts/](concepts/README.md)、セキュリティの決まり(AI ならではの守り・認可・テナント分離)は [docs/security.md](security.md)。ここでは、それがこの雛形のどのファイルに当たるかを並べる。

### 7工程

| 工程 | この雛形のどこ |
|---|---|
| ① 受付 | `.github/ISSUE_TEMPLATE/`(機能・不具合。不具合には requestId の欄) |
| ② 振り分け | Issue の危険度の見込み・`needs-triage` ラベル(ラベルの意味は [docs/guides/labels.md](guides/labels.md)) |
| ③ 仕様 | `docs/specs/`(第1部 PdM: 業務の要求・ルール・受け入れ条件 / 第2部 AI: 状態 × 操作・境界値・権限・STRIDE。承認の基準は `docs/guides/human-review.md` の 6)・`docs/designs/`(設計書と未確定事項。`/design`)・`docs/adr/` |
| ④ 実装 | `CLAUDE.md`・`.claude/skills/`・`.github/workflows/claude.yml`(`@claude`) |
| ⑤ 検証 | `ci.yml`(型・lint・単体・結合・E2E・検査)・`vrt.yml`(見た目の比べ。結果と主な画面を PR のコメントに)・`preview.yml`(PR ごとの環境で E2E と ZAP)・PR の動作確認(`/verify-pr`。本文の「🖱 動作確認」を E2E の部品で確かめ、手順を貼る。`pnpm verify:lint` と記録を疑って読む2層。`docs/guides/verify-pr.md`)・受け入れ(`/accept`。PdM はおすすめの観点を中心に・記録を取るかは使うときに決める・点数と外れた理由は `docs/acceptance/`・`pnpm acceptance`・要求のせいの外れは `docs/domain/resolved-questions.md`) |
| ⑥ レビュー | `pull_request_template.md`(全体像と判断してほしい所を一番上。問いは「事実・理由・問い」)・`docs/review-viewpoints.md`(観点ごとの扱い)・`CODEOWNERS`・`labeler.yml`。直しは `/rework`(上流から作り直す)。考え方は `docs/guides/human-review.md` |
| ⑦ 出荷と監視 | `deploy.yml`(stg 自動 → prod 承認 → ECS の blue/green)・`ecs-service` の 5xx アラームで自動で戻す・構造化ログ |

### 危険度(人が見る量を決める)

| | どこで決まるか |
|---|---|
| パスで自動でラベル | `.github/labeler.yml`(`risk:high` / `risk:medium` / `risk:low`。全部のラベルの意味・誰が付けるか・付いたらどうするかは [docs/guides/labels.md](guides/labels.md)) |
| 「高」は2人 | `.github/CODEOWNERS`(認証・認可・権限の表・移行・infra・.github・ハーネス)+ブランチ保護(下) |
| PR で自己申告 | `pull_request_template.md`(食い違ったら高い方) |
| 依存の更新 | `renovate.json`(開発用の小さい更新は low、major・CI・インフラは high) |
| AI に外へ秘密を書かせない | フック `.claude/hooks/guard-secrets-out.mjs`(外へ書く文章の鍵の形を止める)・背景の AI の前の段(読ませる Issue・PR の書き手)と後ろの段(書いた文章の gitleaks)。[設計書 0060](designs/0060-background-ai-inputs.md) |
| AI に変えさせない所 | 編集と Bash のフック `.claude/hooks/guard-edit.mjs`・`guard-bash.mjs`(CI・権限・移行・infra を編集するときは人の確認。手元だけで外せる。[docs/guides/local-guards.md](guides/local-guards.md)) |

### ハーネス3層

| 層 | この雛形のどこ |
|---|---|
| ① 手元の Claude Code | `CLAUDE.md`(全体・api・web)・`.claude/settings.json` のフック(書いたら Biome・終わる前に型と影響範囲のテスト。2回落ちたら人へ)・`.claude/skills/`(API を足す / DB の移行 / 設計 / 作り直し / リリースノート / 脆弱性の精査 `/cve` / セキュリティの質問票の下書き `/security-questionnaire`)・`.devcontainer/` |
| ② 背景エージェント | `.github/workflows/claude.yml`(Issue / PR の `@claude`。起動できるのはリポジトリの持ち主 OWNER だけ。[docs/security.md の AI-3](security.md)) |
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
| 依存 | Trivy fs・Renovate・Dependabot alerts・精査と対応方針(`/cve`) | `ci.yml` の trivy-fs・`vuln-scan.yml`(定期)・`renovate.json`・`pnpm vulns`([docs/guides/vulnerabilities.md](guides/vulnerabilities.md)) |
| 秘密情報 | gitleaks(全履歴) | `ci.yml` の gitleaks |
| イメージ | Trivy image | `ci.yml` の image |
| インフラ定義 | Trivy config・tflint | `ci.yml`・`terraform.yml` |
| 移行 | squawk | `ci.yml` の migrations |
| ワークフロー | actionlint・zizmor(PR ごとはオフライン。定期はオンライン) | `ci.yml` の workflows・`vuln-scan.yml` |
| 動いている画面 | ZAP ベースライン | `preview.yml` |
| 全 API に変な入力(ロールごと) | Schemathesis | `pnpm security:fuzz`・`security-fuzz.yml` |
| ログインした状態の API | ZAP API スキャン | `zap-api-scan.yml`(stg) |
| AWS の中 | WAF・GuardDuty・Security Hub | `infra/terraform/modules/waf`・`security-baseline` |

何を確かめていて何を確かめていないかの一覧と、深い診断の段取りは [docs/security.md](security.md)。

---

## ✅ CI で回るもの

お金がかかりうるもの(AWS・Claude の API)は、**いまは手動だけ**にしてあります。有効にする手順と費用は [docs/guides/automation.md](guides/automation.md)。

| ワークフロー | いつ | AWS / キーが無いとき |
|---|---|---|
| `ci.yml` | 自動: PR・main | 全部動く(AWS 不要) |
| `terraform.yml` | 自動: infra を変えた PR | fmt・validate・tflint・Trivy |
| `labeler.yml` | 自動: PR | 危険度のラベル |
| `ai-label.yml` | 自動: PR を開いた・本文を直した | AI が手伝った PR にラベル `ai:assisted`(本文の印から。[docs/guides/metrics.md](guides/metrics.md)) |
| `terraform-plan.yml` | 手動(PR の plan は stg だけ。prod は main のときだけ) | 飛ばす(notice を出す) |
| `preview.yml` | 手動(PR の番号を入れる) | 飛ばす(notice を出す) |
| `cleanup-previews.yml` | 手動 | 飛ばす |
| `deploy.yml` | 手動 | 飛ばす |
| `claude.yml` | 手動(頼むことを書く) | 飛ばす(notice を出す) |
| `security-fuzz.yml` | 手動 | 動く(相手はジョブの中の compose) |
| `zap-api-scan.yml` | 手動 | 飛ばす(stg とスキャン用の利用者が要る) |
| `vuln-scan.yml` | 自動: 毎週月曜 5:00(キットのリポジトリでも回す)・手動でも(定期の脆弱性チェック。Trivy fs と zizmor のオンライン版。落ちたら Issue → `/cve`) | 動く(AWS も秘密も要らない) |
| `checkup.yml` | 自動: 毎週月曜 8:00・急ぎは毎日 8:00(キットから作ったリポジトリだけ)・手動でも(点検の知らせ。[docs/checkup/README.md](checkup/README.md)) | 動く(秘密 `CHECKUP_TOKEN`・`SLACK_WEBHOOK_URL` は任意) |
| `demo-reset.yml` | 手動(デモの前に押す。stg の営業のデモ用の組織を戻す。[docs/guides/sales.md](guides/sales.md)) | 飛ばす(`DEMO_TENANT_ID` と stg のデプロイの役割が要る) |
| `metrics.yml` | 自動: 毎週月曜 8:30(キットから作ったリポジトリだけ)・手動でも(週の数字: DORA の4つ・AI が手伝った PR の割合・人の介在率・仕様の在庫を Actions の要約に。[docs/guides/metrics.md](guides/metrics.md)) | 動く(AWS も秘密も要らない) |

**定期で動く物は、キットから作ったリポジトリでだけ動く**(`pnpm setup:github --apply` が変数 `KIT_ROLE=product` を書く)。キットのリポジトリ(ひな形)とセットアップの前は飛ぶ。例外は `vuln-scan.yml`(ひな形でも毎週回す。`.github/setup.yml` の `template_schedules`)。手で流すのはどこでもできる([docs/guides/github-setup.md](guides/github-setup.md))。

`ci.yml` は、画面の JS の大きさ・関数の複雑さとファイルの長さ・テストのカバレッジにも上限を持つ(超えると落ちる)。値と根拠は [docs/guides/ci-limits.md](guides/ci-limits.md)。文書だけの PR では重いジョブ(結合・E2E・イメージ・VRT など)の中身を省いて成功を返す。待ちの内訳と、並んだ PR を入れるときのこつは [docs/guides/ci-speed.md](guides/ci-speed.md)。週100〜200本を流すときの3つのつまみ(マージキュー・センサーだけで入れる範囲・AI の PR の上限)は [docs/guides/throughput.md](guides/throughput.md)。

日々の進め方は [docs/playbook.md](playbook.md)、Slack から頼む形にしたいときは [docs/guides/slack.md](guides/slack.md)。


---

## 📏 わざとやっていないこと(次の一歩)

- **二段階認証の予備のコード・管理者が人の二段階認証を外す画面**: 二段階認証の設定・メールアドレスとパスワードの変更・組織の必須は画面「アカウント」と「設定」にある(docs/specs/0006-account-security.md)。認証アプリを無くした人は、運営が手順書で戻す([docs/runbooks/mfa-reset.md](runbooks/mfa-reset.md))。
- **メールの受け取らない設定・まとめ送り・HTML のメール**(spec 0002 の「やらないこと」)。
- **招待の送り直し・人の無効化・一覧からの人の削除**: 招待は「設定」→「招待」(docs/specs/0027-invitations.md)。送り直しは取り消して招き直す。人を外すのは、SCIM をつないだ組織なら情シスの道具から止める(部品 `scim`)。それ以外はいまも SQL(docs/runbooks/cognito-login.md)。
- **Cognito の独自ドメイン・パスキー**: いまは `<接頭辞>.auth.<region>.amazoncognito.com` とパスワード+TOTP。
- **サーバー側のセッション保存**: 作らない(ADR 0017)。署名つき Cookie で、無操作1時間・ログインから最長12時間で切れる。管理者による強制ログアウトは、保存なしで入れた(`sessions_valid_after`。ADR 0067・部品 `member-sign-out`)。端末を選んで切るのは、要るようになったら DB か Valkey に。
- **1つの画面で組織をまたいで見る**: 1人は複数の組織に所属できる(ADR 0066)が、セッションは1組織分だけ。横断の一覧や検索は作らない。
- **監査ログの「読んだ」記録・消せない S3 への写し・OpenTelemetry のトレース・本物のブラウザでの外形監視(Synthetics)**: ログには traceId を入れてあるので、トレースは後から足せる(当番の決まりは G-08 で足した。[docs/guides/on-call.md](guides/on-call.md))。
- **AI レビュー**(CodeRabbit / Claude の Code Review)と、危険度「低」の自動マージ: 見逃しを数えてから。
- **WAF を「止める」にすること**: stg・prod の CloudFront の前に WAF はある(`infra/terraform/modules/waf`。CloudFront を置かない形では ALB の前)が、入れたばかりは「数えるだけ(count)」。誤検知が無いのを確かめてから `mode = "block"` に([docs/security.md](security.md))。
- **CSP の違反の知らせを集めること**(`report-to`): 画面の CSP はある([設計書 0045](designs/0045-web-csp.md))が、違反を受け取る口は無い。止めた物は E2E の `csp.spec.ts` で見つける。本番で起きた違反を数えたくなったら、受け口を API に足す。

## ⚠️ この雛形の注意

- 編集のフック(`.claude/hooks/guard-edit.mjs`)は、CI・認可・移行・infra のファイルを Claude Code が書くとき人の確認を求める(AI に勝手に変えさせない)。並べたセッションで邪魔なら、手元の `~/.claude/settings.json` の `env` に `KIT_EDIT_GUARD=pr` と書くと確認が出なくなり、PR の段(`risk:high`・CODEOWNERS・「人に判断してほしい所」)が最後の確認になる([docs/guides/local-guards.md](guides/local-guards.md))。
- Windows では `pnpm test:integration` に Docker Desktop が要る。古い Docker Desktop で Testcontainers が待ち続けるときのため、ヘルスチェックだけで待つようにしてある(`test/integration/global-setup.ts`)。
