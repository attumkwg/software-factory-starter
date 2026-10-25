---
name: add-domain
description: API に新しい領域(apps/api/src/domains/<領域>/)を足すときの手順。名前(= Postgres のスキーマ名)・使ってよい向き(dependencies.ts)・フォルダの4つのファイル・スキーマと RLS の移行・列の分類・解約で消す一覧・領域の資料(docs/domain/<領域>/README.md)・領域ごとの CLAUDE.md(型から)・持ち主を、1つの PR でそろえる。「新しい領域を足したい」「領域を分けたい」「チームごとに領域を持たせたい」と言われたとき、または設計書で新しい領域を作ると決めたときに使う。
---

# 新しい領域を足す

領域は「チームが持つ単位」で、AI に「この領域だけ」の文脈を渡す単位でもある(ADR 0004・設計書 `docs/designs/0050-domain-claude-md.md`)。足すのは設計書で決めてから(仕様の無い領域は作らない)。

## 先に決める(設計書に書いてあるか確かめる。無ければ人に聞く)

1. **名前**: 英小文字1語(フォルダ名 = Postgres のスキーマ名。`domain-boundaries` のテストが確かめる)。既存の領域の中で済まないか(済むならそちらに足す)。
2. **使ってよい向き**: どの領域の `index.ts` を使うか。輪にならないか。イベント(アウトボックス)で済まないか。**向きを決めるのは設計**(人に聞く4つではないが、設計書の「決めたこと」に理由を書く)。
3. **持ち主**: どのチームが持つか(人数が増えたら CODEOWNERS)。

## 作る物(1つの PR で)

1. `apps/api/src/domains/dependencies.ts` に1行(`<領域>: ["organizations", …]`)。
2. フォルダ `apps/api/src/domains/<領域>/` に `schema.ts`・`repository.ts`・`routes.ts`・`index.ts`(既存の `projects` が最小の見本)。ほかから使ってよい物だけを `index.ts` から出す。
3. **スキーマと表の移行**: `.claude/skills/db-migration` の手順で。`CREATE SCHEMA <領域>`・アプリのロールへの `GRANT USAGE`(`drizzle/0002_domain_schemas.sql` が見本)・表には `tenant_id` と RLS(`FORCE ROW LEVEL SECURITY`)。移行は危険度「高」(人の確認)。
4. **列の分類**: `apps/api/src/db/classification.ts` に全部の列(区分と目的)。危険度「高」。
5. **解約で消す一覧**: `tenant_id` のある表を `apps/api/src/offboarding/delete-tenant.ts` の `TENANT_TABLES` に。書き出し(`src/export`)に入れるかも決める。
6. **API を足すなら**: `.claude/skills/add-api-endpoint` の手順(権限の表・2社のテスト・監査ログの名前)。
7. **領域の資料**: `docs/domain/<領域>/README.md` を既存の領域と同じ見出しで(エンティティ・状態・守るルール・他の領域との境目・関係するファイル・これから決めること)。用語は `docs/domain/glossary.md` に。
8. **領域ごとの CLAUDE.md**: `docs/domain/_template-CLAUDE.md` を `apps/api/src/domains/<領域>/CLAUDE.md` に写して埋める。触ってよい所・触らない所(使ってよい領域の `index.ts` だけ)・先に読む物・外との出入り(出している関数・出来事・監査ログの名前)・流すテスト。**守るルールは書き写さず README を指す**。
9. `pnpm docs:db`(表の説明書)。
10. 持ち主: 人数が増えていれば `.github/CODEOWNERS` に `apps/api/src/domains/<領域>/` の行(危険度「高」。人が直す。PR の「人に判断してほしい所」に書く)。

## 確かめる

- `pnpm --filter @app/api test`(`domain-boundaries`: 向き・`index.ts` だけ・輪・フォルダ名 = スキーマ名)
- `pnpm --filter @app/api test:integration`(`rls`・`tenant-isolation`・`classification`・`offboarding`)
- `pnpm lint`・`pnpm typecheck`

## してはいけない

- ほかの領域の表を、その領域の `index.ts` を通さずに読む
- 向きを足して輪を作る・何でも使える「共通」の領域を作る
- 領域の CLAUDE.md に、README の守るルールや apps/api の決まりを書き写す(2か所になって食い違う)
