---
name: db-migration
description: DB の表・列・索引を変えるときの手順。止めずに段階的に移行し(拡張 → 移し替え → 縮小)、新しい表には tenant_id と RLS を付け、squawk を通す。スキーマや移行ファイルを触るときに使う。
---

# DB の移行

移行は危険度「高」(人が2人で見る)。**本番を止めない・戻せる**を守る。

## 1. 段階に分ける(1つの PR で全部やらない)

| 段 | やること | 例: 列の名前を変える |
|---|---|---|
| ① 拡張 | 足すだけ。古いコードもそのまま動く | 新しい列を NULL 可で足す |
| ② 両方に書く | アプリを新旧両方に書くようにしてデプロイ | 書くときに両方へ |
| ③ 移し替え | 既存の行を小分けに埋める(ロックを長く取らない) | 1000行ずつ UPDATE |
| ④ 切り替え | 読むのを新しい方にする | 読むのは新しい列 |
| ⑤ 縮小 | 古い物を消す(別の PR・十分たってから) | 古い列を DROP |

- 列を消す・名前を変える・型を変える・NOT NULL を付ける、は1回でやらない。
- スマホのアプリなど古い版から呼ばれる API があるなら、⑤ はさらに後ろへ。

## 2. 手順

1. その領域の `apps/api/src/domains/<領域>/schema.ts` を直す(表は領域の Postgres のスキーマに置く。`organizations.table(...)` など。ADR 0004)。
   - お金は `moneyAmount`+`currencyCode`、単価・率は `decimal`、瞬間は `instant`、日付だけは `dateOnly`(`src/db/columns.ts`。ADR 0005)。
2. `pnpm db:generate --name <内容>` で移行ファイルを作る(`apps/api/drizzle/`)。
3. ファイルの先頭に、ロック待ちの上限を入れる:
   ```sql
   SET LOCAL lock_timeout = '5s';--> statement-breakpoint
   SET LOCAL statement_timeout = '60s';--> statement-breakpoint
   ```
4. **新しい表なら**、同じ PR で RLS を足す(`drizzle/0001_rls.sql` と同じ形。新しいスキーマなら `GRANT USAGE ON SCHEMA ... TO app_rw` も):
   - `tenant_id uuid NOT NULL` と、親の表へは `(tenant_id, id)` の組で参照
   - `ENABLE ROW LEVEL SECURITY` と `FORCE ROW LEVEL SECURITY`
   - `CREATE POLICY tenant_isolation ... USING / WITH CHECK (tenant_id = app_current_tenant())`
   - `GRANT ... TO app_rw`(要る操作だけ)
   - 忘れると結合テスト「全テーブルに RLS」が落ちる
   - **解約の削除の一覧**(`apps/api/src/offboarding/delete-tenant.ts` の `TENANT_TABLES`)に、親より前(子から親の順)に足す。忘れると結合テスト `offboarding.int.test.ts` が落ちる
   - お客さんが持ち出すべき物なら、**書き出し**(`apps/api/src/export/routes.ts` と `ExportSchema`)にも足す(秘密・内部の ID は入れない)
5. 大きい表の索引は `CREATE INDEX CONCURRENTLY`(その移行はトランザクションの外で流す必要がある。人に相談)。
6. `pnpm --filter @app/api db:lint`(squawk)を通す。例外が要るなら、その行の上に `-- squawk-ignore <ルール>` と理由を書き、PR で説明する(`.squawk.toml` で全体を外さない)。
   - 表を別のスキーマへ移す(`SET SCHEMA`)・名前を変えるのは、古い版のアプリを止める。本番があるなら段階を踏む(`drizzle/0002_domain_schemas.sql` の注意書き)。
   - drizzle-kit が対話で聞いてくる変更(表の移動・名前の変更)は、SQL を手で書き、`meta/` の記録は空のフォルダに作り直した形を写す(0002 の作り方)。
7. `pnpm test:integration` で、空の DB から全部の移行が通ることを確かめる。
8. 表の説明書を作り直す: `docker compose up -d` のあと `pnpm docs:db`(`docs/db/` が変わる)。新しい表なら `.tbls.yml` に1行の説明を足し、`docs/domain/<領域>/` のエンティティも直す(`/update-domain-docs`)。

## PR に書くこと

- どの段(①〜⑤)か、次の段はいつか。
- 戻し方(この移行を戻す SQL、またはアプリを前の版に戻しても動く理由)。
- 大きい表に触るなら、行数の見込みとロックの時間の見込み。
