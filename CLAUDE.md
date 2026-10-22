# CLAUDE.md

マルチテナントの TODO アプリ(組織 → プロジェクト → タスク)。AI エージェントが PR を出す前提の雛形。

## コマンド

- `pnpm install` / `pnpm dev`(API 3000 + 画面 5173。先に `docker compose up -d db && pnpm db:migrate && pnpm db:seed`)
- `pnpm lint`(Biome。複雑さ・長さの上限も)/ `pnpm typecheck` / `pnpm test`(単体)/ `pnpm test:coverage`(カバレッジの下限。API は単体+結合で見るので Docker が要る。`docs/guides/ci-limits.md`)/ `pnpm test:integration`(Docker が要る)
- `pnpm test:e2e`(`docker compose up --build -d` のあとで。http://localhost:8080 = ALB の代わり)
- 影響範囲だけ: `pnpm turbo run typecheck test --filter=...[HEAD]`
- `pnpm guards`(危険度「高」の守りが一覧とそろっているか+Bash のフックのテスト)
- `pnpm vulns`(Dependabot の開いている通知のうち精査していない物・見直す日が来た記録。`gh` を使う)
- `pnpm prototypes`(試作が本物と混ざっていないか)/ `pnpm prototype:dev <賭けの ID>`(試作を手元で開く)

## 地図

- `apps/api` … Hono の API。領域ごとに `src/domains/<領域>/`。ルールは `apps/api/CLAUDE.md`
- `apps/web` … TanStack Start の画面(SSR。API とは別のサービス)。ルールは `apps/web/CLAUDE.md`
- `docker/postfix` … メールの中継(本番は ECS で SES へ・手元は Mailpit へ。http://localhost:8025)。`docs/guides/mail.md`
- `packages/fake-cognito` … 開発とテスト専用の偽物の Cognito と、本物と比べる契約テスト(`contract/`)。偽物の振る舞いを変えたら契約テストも直す。手元の AWS の代わりの一覧は `docs/guides/local-environment.md`
- `apps/api/src/audit` … 監査ログ(誰が・いつ・何を)。書き込みの API は認可の関所が自動で記録する。**書き込みの API を足したら `actions.ts` に名前を1行**(無ければ CI が落ちる)。記録は足すだけ
- `apps/api/src/offboarding` … 解約の削除のコマンド(`delete-tenant`。試し → `--execute --confirm-name`)。`tenant_id` の表を足したら `TENANT_TABLES` にも。手順は `docs/runbooks/offboarding.md`
- `apps/api/src/db/classification.ts` … 列の分類表(全部の列に `public` / `internal` / `personal` / `sensitive` と目的)。**列を足したら1行**(無ければ CI が落ちる)。要配慮(`sensitive`)はスキーマ `sensitive` にだけ(ADR 0018)。台帳は `docs/db/personal-data.md`
- `packages/logging` … API と画面のサーバーのログの部品。**出してよい項目だけ出す**(許可リスト。知らない名前は `[REDACTED]`)。ログに新しい名前を出すなら `ALLOWED_KEYS` に足す(人の確認)。ADR 0019
- `packages/error-reporting` … error 以上のログを Sentry に送る(値を落としてから)。Sentry を直接呼ばず、`logger.error({ err }, "…")` で残す。`docs/guides/monitoring.md`
- `packages/shared` … 画面と API の契約(Zod)・お金と時刻の計算(`money.ts`・`time.ts`)。項目は足すだけ・消さない(CI の「API の互換」が見張る)
- `prototypes/<賭けの ID>-<名前>/` … 確かめるための試作(押せる画面だけ・偽のデータ・捨てる物)。`/prototype` が作り、`pnpm prototype:dev <ID>` で手元に開く。本物の API・DB・AWS・秘密を読むと CI が落ちる(`pnpm prototypes`)。`docs/guides/prototypes.md`
- `docs/product/plan.md` … 始め方の計画(誰の困りごと・確かめ方・合格と撤退の線)。`/kickoff` が書く。考え方は `docs/guides/before-pmf.md`
- `docs/product/bets/` … 機能ごとの賭け(仮説・線と期限・小石 = 足すだけの判断の記録・資産か費用かの案)。`/bet` が書き、`pnpm bets` が確かめる。PR の本文に「取り組み」と「作業の種類」。`docs/guides/bets-and-assets.md`
- `docs/authz/matrix.yaml` … 権限の表 / `docs/specs` 仕様 / `docs/designs` 設計書(AI 用・網羅。未確定事項もここ)/ `docs/adr` 設計判断(番号は `pnpm adr` が出す「次の番号」。重なると CI が落ちる)/ `docs/runbooks` 手順(障害のときの入口は `incident.md`)
- `docs/review-viewpoints.md` … 設計とレビューの観点(共通の8つ+このプロダクト特有)。人が気づいた観点は足していく。使い方は `docs/guides/human-review.md`
- `infra/terraform` … AWS(modules と envs)。**apply はしない**(人が CI で行う)

## 必ず守る

- 仕様(Issue の受け入れ条件か `docs/specs/`)の無い変更はしない。分からなければ PR で「人に判断してほしい所」に書く。
- 1 Issue = 1 PR。PR テンプレートの欄(危険度・テスト結果・判断してほしい所)を全部埋める。
- 何を作るか・作る前に何を確かめるか → `/kickoff`。キットの部品の残す・消す → `/tailor`(正は `docs/kit/catalog.yaml`。部品を足したら1件足す。`pnpm kit:catalog`)。機能1つぶんを確かめながら作る → `/bet`(新しい機能は賭けの ID から)。脆弱性(CVE・Dependabot の通知)の精査と対応方針 → `/cve`(届く・まだ直していない穴の中身はリポジトリにも Issue にも書かない。`docs/guides/vulnerabilities.md`)。新しい API → `.claude/skills/add-api-endpoint`。DB の変更 → `.claude/skills/db-migration`。設計 → `/design`。直す → `/rework`。
- **人に聞くのは4つだけ**: 事業判断・利用者の挙動・他チームとの契約や制約・戻せないリスク。それ以外は聞かずに決め、設計書の「決めたこと」に理由を書く。4つに当たる判断は止まらずに仮に決め、設計書の「未確定事項」に `仮決め` で残す(人の答えなしに `承認` にしない)。`仮決め` が残る PR はマージに回さない(`pnpm decisions --strict`)。
- **誤りは、入った工程から作り直す**(ナレッジ → 要求 → 設計 → 実装 → テスト)。上流の誤りをコードだけで継ぎ当てない(`/rework`)。
- CI が落ちたら直すのは2回まで。3回目は止めて、PR に状況を書いて人に渡す。

## してはいけない

- テナントをリクエストの値(URL・本文・ヘッダー)で決める。テナントはセッションからだけ。
- ルートやリポジトリで接続プール(`RootDb`)を直接使う。`c.var.tx`(テナントの文脈つき)だけを使う。
- ログにオブジェクトを丸ごと渡す(`logger.info(user)`)。必要な項目だけを `{ userId }` の形で。
- 秘密・本番の値をコード・ログ・PR に書く。`.env` を読む・作る。
- 本番の DB や AWS に書き込む操作(戻す・入れ替える・止める)を自分で打つ。手順書(`docs/runbooks/`)のコマンドを、確かめた形で人に渡す。
- 人の承認なしに次を変える(危険度「高」): 一覧は `.claude/hooks/protected-paths.json`(認証・認可・DB・移行・権限の表・infra・CI・ハーネス・検査の除外・依存の入れ方)。Edit・Write は確認が出る。Bash で書き換えて確認を避けない(フックが聞く)
- main へ push する・強制 push する・PR をマージする・承認する(フックが止める。`docs/guides/local-guards.md`)
