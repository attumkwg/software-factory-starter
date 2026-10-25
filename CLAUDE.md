# CLAUDE.md

マルチテナントの TODO アプリ(組織 → プロジェクト → タスク)。AI エージェントが PR を出す前提の雛形。

## コマンド

- `pnpm install` / `pnpm dev`(API 3000 + 画面 5173。先に `docker compose up -d db && pnpm db:migrate && pnpm db:seed`)
- `pnpm lint`(Biome。複雑さ・長さの上限も)/ `pnpm typecheck` / `pnpm test`(単体)/ `pnpm test:coverage`(カバレッジの下限。API は単体+結合で見るので Docker が要る。`docs/guides/ci-limits.md`)/ `pnpm test:integration`(Docker が要る)
- `pnpm test:e2e`(`docker compose up --build -d` のあとで。http://localhost:8080 = ALB の代わり)
- `pnpm vrt`(見た目の回帰テスト。先に `docker compose -f docker-compose.vrt.yml up -d --wait` で Docker の中のブラウザも)/ `pnpm vrt:update`(画面を変えたときだけ。撮り直した画像を見てからコミット)。`docs/guides/vrt.md`
- 影響範囲だけ: `pnpm turbo run typecheck test --filter=...[HEAD]`
- `pnpm guards`(危険度「高」の守りが一覧とそろっているか+Bash のフックのテスト)
- `pnpm setup:github`(GitHub の設定を `.github/setup.yml`・`.github/labels.yml` にそろえる。既定は試しで差分だけ・`--apply` で反映。**人が打つ**(AI は試しまで))/ `pnpm setup:check`(使うラベル・必須のチェック・Environment・定期の見分け・ラベルの手引きが設定ファイルとずれていないか。CI)/ `pnpm setup:labels`(ラベルの手引き `docs/guides/labels.md` を作り直す)。`docs/guides/github-setup.md`
- `pnpm vendors`(委託先の台帳 `docs/compliance/vendors.yaml` とコードの照らし合わせ。CI)/ `pnpm vendors --write`(人が読む一覧 `vendors.md` を作り直す)
- `pnpm vulns`(Dependabot の開いている通知のうち精査していない物・見直す日が来た記録。`gh` を使う)
- `pnpm self-contained`(キットの外の資料を指していないか。根拠は `docs/concepts/` と `docs/security.md` の番号つきの決まりを指す)
- `pnpm checkup`(点検の台帳 `docs/checkup/todo.yaml` から、いまの段階に当たる項目を出し、自動で確かめられる物を確かめる。`gh` を使う。台帳を直したら `--write-readme`。答えは `/checkup` が `pnpm checkup:answer` で書く。キットから作ったら一度 `pnpm checkup:adopt --by @自分`。`--issue`・`--urgent` は知らせ(`checkup.yml` が毎週・毎日流す。手元では打たない))
- `pnpm prototypes`(試作が本物と混ざっていないか)/ `pnpm prototype:dev <賭けの ID>`(試作を手元で開く)

## 地図

- **入口の分け方**: ルートの `README.md` は使い始める人向けの短い入口(手で直してよいが、詳しい中身は足さない。`<!-- kit:readme -->` の間は `pnpm kit:readme` が作る)。**どこに何があるかを探すときは `docs/reference.md`**(ファイルの地図・手元のコマンドの全部・考え方とファイルの対応・CI で回る物・わざとやっていないこと・注意)と `docs/README.md`(docs の地図)から。手でやる設定(GitHub・AWS・OIDC の変数・Slack・バックアップ・運営の組織)は `docs/guides/manual-setup.md`
- `docs/scenarios/` … 想定の場面(架空の A 社 10人・B 社 100人が企画から運用まで回す台本)と、足りない物の一覧 `gaps.md`(G-01 など)。**部品を足した・穴を埋めた PR では、当たる場面の判定と `gaps.md` の行も直す**。何を足すか迷ったら `gaps.md` の上から
- `apps/api` … Hono の API。領域ごとに `src/domains/<領域>/`。ルールは `apps/api/CLAUDE.md`
- `apps/web` … TanStack Start の画面(SSR。API とは別のサービス)。ルールは `apps/web/CLAUDE.md`
- `docker/postfix` … メールの中継(本番は ECS で SES へ・手元は Mailpit へ。http://localhost:8025)。`docs/guides/mail.md`
- `packages/fake-cognito` … 開発とテスト専用の偽物の Cognito と、本物と比べる契約テスト(`contract/`)。偽物の振る舞いを変えたら契約テストも直す。手元の AWS の代わりの一覧は `docs/guides/local-environment.md`
- `apps/api/src/audit` … 監査ログ(誰が・いつ・何を)。書き込みの API は認可の関所が自動で記録する。**書き込みの API を足したら `actions.ts` に名前を1行**(無ければ CI が落ちる)。記録は足すだけ
- `apps/api/src/feature-flags` … 組織ごとの機能フラグ(定義は `packages/shared` の `FEATURE_FLAGS`・賭けに結びつける)。機能の API は `requireFeature`、画面は `hasFeature(me, …)`。切り替えは運営のコマンドだけ。使われたかは `apps/api/src/usage` の `recordUsage`(1日1人1機能1行。中身・時刻は記録しない・400日で消す)で測る。`docs/guides/feature-flags.md`
- `apps/api/src/offboarding` … 解約の削除のコマンド(`delete-tenant`。試し → `--execute --confirm-name`)。`tenant_id` の表を足したら `TENANT_TABLES` にも。手順は `docs/runbooks/offboarding.md`
- `apps/api/src/db/classification.ts` … 列の分類表(全部の列に `public` / `internal` / `personal` / `sensitive` と目的)。**列を足したら1行**(無ければ CI が落ちる)。要配慮(`sensitive`)はスキーマ `sensitive` にだけ(ADR 0018)。台帳は `docs/db/personal-data.md`
- `apps/api/src/sensitive` … 要配慮個人情報の入口(段1。ADR 0029)。別の接続(ロール `app_sensitive`)と、組織ごとのデータ鍵(KMS で包む)で列ごとに暗号化。**要配慮の表の読み書きはこのフォルダの中だけ**(外からは `index.ts`。触ると Semgrep が落ちる)。段を上げる手順は `docs/runbooks/sensitive-data-tiers.md`
- `packages/logging` … API と画面のサーバーのログの部品。**出してよい項目だけ出す**(許可リスト。知らない名前は `[REDACTED]`)。ログに新しい名前を出すなら `ALLOWED_KEYS` に足す(人の確認)。ADR 0019
- `packages/error-reporting` … error 以上のログを Sentry に送る(値を落としてから)。Sentry を直接呼ばず、`logger.error({ err }, "…")` で残す。`docs/guides/monitoring.md`
- `packages/shared` … 画面と API の契約(Zod)・お金と時刻の計算(`money.ts`・`time.ts`)。項目は足すだけ・消さない(CI の「API の互換」が見張る)
- `prototypes/<賭けの ID>-<名前>/` … 確かめるための試作(押せる画面だけ・偽のデータ・捨てる物)。`/prototype` が作り、`pnpm prototype:dev <ID>` で手元に開く。本物の API・DB・AWS・秘密を読むと CI が落ちる(`pnpm prototypes`)。`docs/guides/prototypes.md`
- `docs/compliance/` … 認証(P マーク・ISMS)の準備。附属書 A の管理策の一覧 `controls.yaml`(正)から適用宣言書 `soa.md` を `pnpm compliance --write` で作る(古い・根拠のリンク切れ・台帳が無い管理策を指すと CI が落ちる)。規程のひな形は `policies/`。毎月の証跡は `evidence.yml` が消せない S3 へ(`pnpm evidence --list`)。期限の来た見直し・教育・内部監査は `/compliance-check`
- `docs/cost/`・`scripts/cost/` … 費用のページ(何にいくら・動いている物ごと・見積もりとの比べ)。`cost.yml` が非公開の S3 に置く(公開の場所に出さない)。AWS のリソースにはタグ `Component`(provider の別名で付ける)と `Bet`。SaaS の月額は `docs/cost/saas.yaml`・見積もりは `estimates.yaml`。人の時間(PR からの目安と手入力の幅)と賭けごとの PL も出す(分数は `people.yaml`。時給・売上は非公開の S3 の `cost/inputs/` だけ。リポジトリに金額を置かない)。月1回の資産と費用の区分の案は `/ledger`。`docs/guides/cost-dashboard.md`
- `docs/product/plan.md` … 始め方の計画(誰の困りごと・確かめ方・合格と撤退の線)。`/kickoff` が書く。考え方は `docs/guides/before-pmf.md`
- `docs/product/bets/` … 機能ごとの賭け(仮説・線と期限・小石 = 足すだけの判断の記録・資産か費用かの案)。`/bet` が書き、`pnpm bets` が確かめる。PR の本文に「取り組み」と「作業の種類」。`docs/guides/bets-and-assets.md`
- `docs/product/positioning.md` … 約束(誰の何を、どう変えるか)・売り文句・代わりとの違い・言わないこと・根拠(どの記録・小石か)。`/positioning` が書く(PSF の後。LP・ブランドはここから)
- `docs/concepts/` … 考え方の本体(7工程・ハーネス3層・段階と費用・人と AI の分担・長く回す)。`docs/security.md` … セキュリティの決まり(`AI-n`・`AZ-n`・`L-n`・`T-n`・`V-n`・`D-n`。番号は動かさない)と確かめ方。**根拠はこの2つを指す**(外の資料や PR の番号を根拠にしない。`pnpm self-contained`)
- `docs/authz/matrix.yaml` … 権限の表 / `docs/specs` 仕様 / `docs/designs` 設計書(AI 用・網羅。未確定事項もここ。番号は仕様と対で同じ。`pnpm adr` が出す「仕様と設計書の次の番号」)/ `docs/adr` 設計判断(番号は `pnpm adr` が出す「次の番号」。仕様・設計書・設計判断とも、同じフォルダで重なると CI が落ちる)/ `docs/runbooks` 手順(障害のときの入口は `incident.md`)
- `docs/compliance/` … 認証の準備(P マーク・ISMS)の入口。委託先の台帳 `vendors.yaml`(外の会社ごとに預け方・国・区分・契約・消え方)。**外のサービスの SDK・新しい種類の AWS の資源・Actions を足したら台帳に1件か1行**(無ければ CI が落ちる。台帳は人の確認が要る)。AI に渡すデータの決まり `ai-data.md`。AWS の管理操作の記録は `infra/terraform/modules/audit-trail`(手順は `docs/runbooks/audit-trail.md`)
- `docs/review-viewpoints.md` … 設計とレビューの観点(共通の8つ+このプロダクト特有)。人が気づいた観点は足していく。使い方は `docs/guides/human-review.md`
- `infra/terraform` … AWS(modules と envs)。**apply はしない**(人が CI で行う)
- `.github/setup.yml`・`.github/labels.yml` … GitHub の設定とラベルの正(ADR 0027)。**ラベルを使う物を足したら `labels.yml` に1件(意味・誰が・いつ・付いたらどうするか)・ジョブの名前を変えたら `required_checks` も**(無ければ CI が落ちる)。PR に「マージの後に人がやる設定」を書かず、設定ファイルを直す(マージの後に人が `pnpm setup:github --apply`)。定期で動くワークフローは `vars.KIT_ROLE == 'product'` のときだけ(ひな形では運用を回さない)

## 必ず守る

- 仕様(Issue の受け入れ条件か `docs/specs/`)の無い変更はしない。分からなければ PR で「人に判断してほしい所」に書く。
- 1 Issue = 1 PR。PR テンプレートの欄(危険度・テスト結果・判断してほしい所)を全部埋める。
- 何を作るか・作る前に何を確かめるか → `/kickoff`。キットの部品の残す・消す → `/tailor`(正は `docs/kit/catalog.yaml`。部品を足したら1件足す。`pnpm kit:catalog`)。機能1つぶんを確かめながら作る → `/bet`(新しい機能は賭けの ID から)。約束と売り文句(LP・チラシ・営業の言葉の元。PSF の後)→ `/positioning`。点検で担当者に聞くこと・手でやること → `/checkup`(1問ずつ。答えは台帳に書いて PR)。認証(P マーク・ISMS)の準備の期限(規程の見直し・教育・内部監査)→ `/compliance-check`(`/checkup` の一種)。点検の台帳に世の中の変化を取り込む(月1回・人が起動)→ `/checkup-refresh`。脆弱性(CVE・Dependabot の通知)の精査と対応方針 → `/cve`(届く・まだ直していない穴の中身はリポジトリにも Issue にも書かない。`docs/guides/vulnerabilities.md`)。新しい API → `.claude/skills/add-api-endpoint`。DB の変更 → `.claude/skills/db-migration`。設計 → `/design`。直す → `/rework`。
- **人に聞くのは4つだけ**: 事業判断・利用者の挙動・他チームとの契約や制約・戻せないリスク。それ以外は聞かずに決め、設計書の「決めたこと」に理由を書く。4つに当たる判断は止まらずに仮に決め、設計書の「未確定事項」に `仮決め` で残す(人の答えなしに `承認` にしない)。`仮決め` が残る PR はマージに回さない(`pnpm decisions --strict`)。
- **誤りは、入った工程から作り直す**(ナレッジ → 要求 → 設計 → 実装 → テスト)。上流の誤りをコードだけで継ぎ当てない(`/rework`)。
- CI が落ちたら直すのは2回まで。3回目は止めて、PR に状況を書いて人に渡す。

## してはいけない

- テナントをリクエストの値(URL・本文・ヘッダー)で決める。テナントはセッションからだけ。
- ルートやリポジトリで接続プール(`RootDb`)を直接使う。`c.var.tx`(テナントの文脈つき)だけを使う。
- ログにオブジェクトを丸ごと渡す(`logger.info(user)`)。必要な項目だけを `{ userId }` の形で。
- 本番の個人データ(名前・メールアドレス・題名・本文・画面のスクショ)を読む・求める。受け取ってよいのは ID と集計まで。要配慮は件数も受け取らない(`docs/security.md` の AI-6・`docs/compliance/ai-data.md`)。貼られたら使わずに、そう伝える
- 秘密・本番の値をコード・ログ・PR に書く。`.env` を読む・作る。
- 要配慮個人情報(スキーマ `sensitive` の中身・暗号文・復号した値・データ鍵)を読む・ログや PR や Issue に書く・自分の調べの材料にする。事故の調べでも、受け取るのは組織・利用者の ID と鍵の利用の記録の形(誰が・いつ)まで。要配慮の件数も受け取らない(AI-6・`docs/runbooks/incident.md` の 2)。
- 本番の DB や AWS に書き込む操作(戻す・入れ替える・止める)を自分で打つ。手順書(`docs/runbooks/`)のコマンドを、確かめた形で人に渡す。
- 人の承認なしに次を変える(危険度「高」): 一覧は `.claude/hooks/protected-paths.json`(認証・認可・DB・移行・権限の表・infra・CI・ハーネス・検査の除外・依存の入れ方)。Edit・Write は確認が出る(使う人が手元の `env` に `KIT_EDIT_GUARD=pr` と書いたときは出ない。そのときは PR の危険度を「高」にして、変えた理由を「人に判断してほしい所」に書く)。Bash で書き換えて確認を避けない(フックが聞く)。変数は自分で書かない
- main へ push する・強制 push する・PR をマージする・承認する(フックが止める。`docs/guides/local-guards.md`)
