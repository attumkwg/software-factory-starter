# ADR 0004: 領域ごとにフォルダと Postgres のスキーマを分ける(モジュラーモノリス)

- 状態: 採用
- 日付: 2026-10-18
- 決めた人: @attumkwg

## 背景

テーブルが数十のうちは、どのコードがどの表を読んでもすぐには困らない。だが数百・数千になると「全部が全部を読む」状態になり、後から領域ごとに DB やサービスを分けようとしても分けられない(scale.md「最初から決めておく」)。AI は目の前の表を素直に読みに行くので、決まりを仕組みで守らないと、PR のたびに少しずつ絡まる。

## 選択肢

| 案 | 良い所 | 弱い所 |
|---|---|---|
| A. フォルダ+Postgres のスキーマ+CI | 境界がコードと DB の両方に見える。将来 DB を分けるときは「接続先を変える」と「領域をまたぐ外部キーを切る」だけ | 最初の移行が要る(本番が無い今がいちばん安い) |
| B. フォルダ+CI だけ | 移行が要らない | 将来 DB を分けるときに表を移す作業が残る。DB を見ても境界が分からない |
| C. 最初からサービスを分ける | 境界が一番固い | PMF 前には重すぎる(デプロイ・通信・トランザクションが増える) |

## 決めたこと

**A**(本人の選択)。

- 領域は `docs/domain/` と同じ名前: `organizations`(組織と人)・`projects`・`tasks`。
- コードは `apps/api/src/domains/<領域>/{schema,repository,routes,index}.ts`。**ほかからは `index.ts` だけを使う**。
- 使ってよい向きは `apps/api/src/domains/dependencies.ts` に書く。いまは `projects → organizations`、`tasks → organizations, projects`。輪は作らない。
- 表は領域の名前の Postgres のスキーマに置く(`organizations.users`・`projects.projects`・`tasks.tasks`)。共通の仕組み(送信待ち)はスキーマ `platform`。
- **例外**: 外部キーのために、`schema.ts` どうしは import してよい(`(tenant_id, id)` の組で張り、別テナントの行を指せないようにするため)。

CI で守る: `apps/api/test/unit/domain-boundaries.test.ts`(向き・入口・輪・スキーマ名。見張り自体のテストつき)。

## 領域をまたぐ外部キー(DB を分けるときに切る一覧)

| 表 | 指す先 | 分けるときの代わり |
|---|---|---|
| `projects.projects.(tenant_id, created_by)` | `organizations.users` | ID だけを持ち、存在の確認は organizations の API で |
| `tasks.tasks.(tenant_id, project_id)` | `projects.projects`(消すと一緒に消える) | projects が「消した」出来事を出し(アウトボックス)、tasks が受けて消す |
| 各表の `tenant_id` | `organizations.tenants` | テナントは全領域の土台。最後まで残してよい |

## 結果として起きること

- 良くなること: どこまでが1つの領域かが、フォルダと DB で見える。AI に「1タスク1領域」で渡せる。将来の分割の道筋が決まっている。
- 我慢すること: ほかの領域のデータが要るとき、表を直接読まずに `index.ts` へ関数を足す手間がある。SQL で表を書くときにスキーマ名が要る。
- 見直す合図: `dependencies.ts` の向きが増え続ける(領域の切り方が合っていない)/ 1つの領域が大きくなりすぎた(テーブルが50を超えるなど)/ 領域ごとに別のチームが持つようになった(サービスに分ける検討)。
