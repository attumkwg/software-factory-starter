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
   - **列を足したら、列の分類表 `apps/api/src/db/classification.ts` に1行**(区分 `public` / `internal` / `personal` / `sensitive` と利用目的の一言)。決め方は分類表の先頭。迷ったら重い方(人が入れる自由な文は `personal`)。jsonb の列は中身のキーも書く。無ければ `test/unit/classification.test.ts` が落ちる。続けて `pnpm docs:personal-data`(個人情報の台帳 `docs/db/personal-data.md`)。
   - **`sensitive`(要配慮個人情報: 病歴・障害・信条・犯罪の経歴など)は、人の確認が必須。** 仕様で「要配慮に当たる」と人が答えていない列を `sensitive` にしない・`sensitive` を外さない(迷ったら止めて PR の「人に判断してほしい所」に書く)。区分を変える PR も同じ。
     - 置けるのはスキーマ `sensitive` の表だけ・型は text(暗号文)だけ(`classification.test.ts` が落ちる)。表は `apps/api/src/sensitive/` の中に書く(`sensitive.table(...)`。外に書くと Semgrep が落ちる)。
     - 移行では、`GRANT … ON sensitive.<表> TO app_sensitive`(要る操作だけ。**`app_rw` には何も渡さない**)・RLS(下の 4 と同じ形)・ほかのスキーマの表へ外部キーを張らない(段2で持ち出せるように)・`TENANT_TABLES` の `sensitive.tenant_keys` より前。
     - 値は `src/sensitive/` の `seal()` で暗号化してから書く。検索・並べ替えが要るなら、ハッシュの列を別に足す(設計書で決める)。
     - stg・prod で初めて使うなら、Terraform の `sensitive_data_enabled` と接続ユーザー(`docs/runbooks/sensitive-data-tiers.md` の 1)。PR に書いて人に渡す。
   - `personal` の列を足すと、プライバシーポリシーの「取得する情報と利用目的」が変わりうる。PR の「人に判断してほしい所」に、台帳に増えた行を貼る。
2. `pnpm db:generate --name <内容>` で移行ファイルを作る(`apps/api/drizzle/`)。
3. ファイルの先頭に、ロック待ちの上限を入れる:
   ```sql
   SET LOCAL lock_timeout = '5s';--> statement-breakpoint
   SET LOCAL statement_timeout = '60s';--> statement-breakpoint
   ```
4. **新しい表なら**、同じ PR で RLS を足す(`drizzle/0001_rls.sql` と同じ形。新しいスキーマなら `GRANT USAGE ON SCHEMA ... TO app_rw` も。**スキーマ `sensitive` だけは `app_rw` ではなく `app_sensitive`**。`drizzle/0013_sensitive_schema.sql`):
   - `tenant_id uuid NOT NULL` と、親の表へは `(tenant_id, id)` の組で参照
   - `ENABLE ROW LEVEL SECURITY` と `FORCE ROW LEVEL SECURITY`
   - `CREATE POLICY tenant_isolation ... USING / WITH CHECK (tenant_id = app_current_tenant())`
   - `GRANT ... TO app_rw`(要る操作だけ)
   - 忘れると結合テスト「全テーブルに RLS」が落ちる
   - **解約の削除の一覧**(`apps/api/src/offboarding/delete-tenant.ts` の `TENANT_TABLES`)に、親より前(子から親の順)に足す。忘れると結合テスト `offboarding.int.test.ts` が落ちる
   - お客さんが持ち出すべき物なら、**書き出し**(`apps/api/src/export/routes.ts` と `ExportSchema`)にも足す(秘密・内部の ID は入れない)
5. **すでにある表への索引は、トランザクションの外で `CONCURRENTLY` で作る**(書き込みを止めない。ADR 0016)。drizzle の移行は全部を1つのトランザクションで流すので、`CREATE INDEX CONCURRENTLY` は `apps/api/drizzle/concurrent/` に置く(`src/db/migrate.ts` が drizzle の移行の後に、1文ずつ流す。流した物は `drizzle.concurrent_migrations`)。見本は `drizzle/concurrent/0008_list_indexes.sql`。
   - `schema.ts` に `index(...)` を足して `pnpm db:generate` → できた `drizzle/NNNN_*.sql` の `CREATE INDEX` は消して(記録 `meta/` をそろえるためだけに残す)、同じ番号・名前で `drizzle/concurrent/NNNN_*.sql` に `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` を書く。
   - 先頭に `SET lock_timeout = '1min';` と `SET statement_timeout = '1h';`(`LOCAL` ではない)。区切りは drizzle と同じ `--> statement-breakpoint`。
   - 何度流しても同じになる形だけ(`IF NOT EXISTS` / `IF EXISTS`)。途中で落ちて「使えない索引」が残っても、次の移行で消してから作り直す。
   - 置いてよいのは索引を作る・消すだけ(表・列・制約は drizzle の移行で)。drizzle の移行は先に全部流れるので、ここで作る索引に頼らない。
   - 新しい表(同じ移行で作る表)への索引は、ふつうに drizzle の移行の中でよい(空なので止まらない)。
   - 1時間で終わらないほど大きい表は、デプロイの外で人が流す: 同じ SQL を `psql` で1文ずつ流してから `insert into drizzle.concurrent_migrations (name) values ('NNNN_*.sql')`(PR に書いて人に渡す)。
6. `pnpm --filter @app/api db:lint`(squawk。`drizzle/concurrent/` はトランザクションの外として調べる)を通す。例外が要るなら、その行の上に `-- squawk-ignore <ルール>` と理由を書き、PR で説明する(`.squawk.toml` で全体を外さない)。
   - 表を別のスキーマへ移す(`SET SCHEMA`)・名前を変えるのは、古い版のアプリを止める。本番があるなら段階を踏む(`drizzle/0002_domain_schemas.sql` の注意書き)。
   - drizzle-kit が対話で聞いてくる変更(表の移動・名前の変更)は、SQL を手で書き、`meta/` の記録は空のフォルダに作り直した形を写す(0002 の作り方)。
7. `pnpm test:integration` で、空の DB から全部の移行が通ることを確かめる。
8. 表の説明書を作り直す: `docker compose up -d` のあと `pnpm docs:db`(`docs/db/` が変わる)。新しい表なら `.tbls.yml` に1行の説明を足し、`docs/domain/<領域>/` のエンティティも直す(`/update-domain-docs`)。

## PR に書くこと

- どの段(①〜⑤)か、次の段はいつか。
- 足した列の区分(`personal` / `sensitive` があれば、台帳に増えた行をそのまま)。`sensitive` があれば「人に判断してほしい所」に1行(要配慮に当たると答えた仕様の場所・取る前の同意の画面)。危険度は「高」。
- 戻し方(この移行を戻す SQL、またはアプリを前の版に戻しても動く理由)。
- 大きい表に触るなら、行数の見込みとロックの時間の見込み。
