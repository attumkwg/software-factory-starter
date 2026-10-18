# CLAUDE.md

マルチテナントの TODO アプリ(組織 → プロジェクト → タスク)。AI エージェントが PR を出す前提の雛形。

## コマンド

- `pnpm install` / `pnpm dev`(API 3000 + 画面 5173。先に `docker compose up -d db && pnpm db:migrate && pnpm db:seed`)
- `pnpm lint`(Biome)/ `pnpm typecheck` / `pnpm test`(単体)/ `pnpm test:integration`(Docker が要る)
- `pnpm test:e2e`(`docker compose up --build -d` のあとで。http://localhost:8080 = ALB の代わり)
- 影響範囲だけ: `pnpm turbo run typecheck test --filter=...[HEAD]`

## 地図

- `apps/api` … Hono の API。ルールは `apps/api/CLAUDE.md`
- `apps/web` … TanStack Start の画面(SSR。API とは別のサービス)。ルールは `apps/web/CLAUDE.md`
- `packages/shared` … 画面と API の契約(Zod)。項目は足すだけ・消さない
- `docs/authz/matrix.yaml` … 権限の表 / `docs/specs` 仕様 / `docs/adr` 設計判断 / `docs/runbooks` 手順
- `infra/terraform` … AWS(modules と envs)。**apply はしない**(人が CI で行う)

## 必ず守る

- 仕様(Issue の受け入れ条件か `docs/specs/`)の無い変更はしない。分からなければ PR で「人に判断してほしい所」に書く。
- 1 Issue = 1 PR。PR テンプレートの欄(危険度・テスト結果・判断してほしい所)を全部埋める。
- 新しい API → `.claude/skills/add-api-endpoint`。DB の変更 → `.claude/skills/db-migration`。
- CI が落ちたら直すのは2回まで。3回目は止めて、PR に状況を書いて人に渡す。

## してはいけない

- テナントをリクエストの値(URL・本文・ヘッダー)で決める。テナントはセッションからだけ。
- ルートやリポジトリで接続プール(`RootDb`)を直接使う。`c.var.tx`(テナントの文脈つき)だけを使う。
- ログにオブジェクトを丸ごと渡す(`logger.info(user)`)。必要な項目だけを `{ userId }` の形で。
- 秘密・本番の値をコード・ログ・PR に書く。`.env` を読む・作る。
- 人の承認なしに次を変える(危険度「高」): `apps/api/src/auth` `apps/api/src/authz` `apps/api/src/db` `apps/api/drizzle` `docs/authz` `infra` `.github` `.claude/settings.json`
