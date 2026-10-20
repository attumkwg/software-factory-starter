# ADR 0016: すでにある表の索引は、トランザクションの外の移行(drizzle/concurrent)で作る

- 状態: 提案
- 日付: 2026-10-20
- 決めた人: (人の承認待ち)

## 背景

一覧のページング(`docs/guides/api-changes.md`「一覧は必ずページング」)のために、プロジェクトとタスクの表へ並びに合う索引を足す。表はもう本番にある前提で、行は増え続ける。

drizzle の移行(`migrate()`)は、まだ流していない移行を**全部1つのトランザクションで**流す。その中の `CREATE INDEX` は、作り終わるまで表への書き込みを止める(大きい表なら数分)。書き込みを止めない `CREATE INDEX CONCURRENTLY` は、トランザクションの中では流せない。squawk も、すでにある表への `CONCURRENTLY` の無い索引を止める(`require-concurrent-index-creation`)。

## 選択肢

| 案 | 良い所 | 弱い所 |
|---|---|---|
| A. drizzle の移行に `CREATE INDEX` を書き、squawk の例外にする | 仕組みが増えない | 表が大きいと、デプロイのたびに書き込みが止まる |
| B. 索引は人が手で `psql` から張る | アプリは何も変えない | 手順を忘れる。手元・テスト・プレビューの DB とずれる |
| C. `drizzle/concurrent/*.sql` を、drizzle の移行の後にトランザクションの外で流す | 書き込みを止めない。手元・テスト・本番が同じ道を通る。squawk でも確かめられる | 移行の仕組みが少し増える(`src/db/migrate.ts`) |

## 決めたこと

C にする。

- `src/db/migrate.ts` が、drizzle の移行の後に `drizzle/concurrent/*.sql` を名前の順に1文ずつ流す。流した物は `drizzle.concurrent_migrations` に残し、二度は流さない。
- 2つの移行のタスクが同時に動いても、勧告ロック(`pg_advisory_lock`)で1つずつ。
- `CONCURRENTLY` が途中で落ちると「使えない索引」が残る。次に流すとき、そのファイルに名前が出てくる「使えない索引」だけを消してから作り直す。
- ファイルは何度流しても同じになる形(`IF NOT EXISTS`)。置いてよいのは索引を作る・消すだけ。
- drizzle の記録(`meta/`)を `schema.ts` とそろえるため、同じ番号の drizzle の移行も置く(中の `CREATE INDEX` は消す)。
- squawk は `drizzle/concurrent/` を「トランザクションの外」として調べる(`pnpm --filter @app/api db:lint`)。
- 手順は `.claude/skills/db-migration` の 5。

## 結果として起きること

- 良くなること: 大きい表に索引を足しても、デプロイの間に書き込みが止まらない。
- 我慢すること: drizzle の移行は、`concurrent/` の索引より先に全部流れる。drizzle の移行から、ここで作る索引に頼れない。索引の作り直しは `concurrent/` の新しいファイルで。
- 見直す合図: 1時間で作り終わらない表が出たとき(移行のタスクの外で、人が流す手順にする)。drizzle がトランザクションの外の移行を持つようになったとき(そちらに移す)。
