---
name: add-domain
description: API に新しい領域(apps/api/src/domains/<領域>/)を足すときの手順。名前(= Postgres のスキーマ名)・使ってよい向き(dependencies.ts)・フォルダのファイル(schema・repository・routes・index)と全部の表を集める所・ルートの登録・スキーマと RLS の移行・列の分類・解約で消す一覧・領域の資料(docs/domain/<領域>/README.md)・領域ごとの CLAUDE.md(型から)・持ち主を、1つの PR でそろえる。「新しい領域を足したい」「領域を分けたい」「チームごとに領域を持たせたい」と言われたとき、または設計書で新しい領域を作ると決めたときに使う。
---

# 新しい領域を足す

領域は「チームが持つ単位」で、AI に「この領域だけ」の文脈を渡す単位でもある(ADR 0004・設計書 `docs/designs/0050-domain-claude-md.md`)。足すのは設計書で決めてから(仕様の無い領域は作らない)。手順は、一時的な領域を作って CI の点検が全部通るかで確かめてある(仕様 0090)。

## 先に決める(設計書に書いてあればそれに従う。無ければ AI が決めて、設計書に書く)

人に聞くのはルートの `CLAUDE.md` の4つ(事業判断・利用者の挙動・他チームとの契約や制約・戻せないリスク)だけ。下の 1・2 はどれにも当たらないので、聞かずに決めて設計書の「決めたこと」に理由を書く。

1. **名前**: 英小文字1語(フォルダ名 = Postgres のスキーマ名。`domain-boundaries` のテストが確かめる)。既存の領域の中で済まないか(済むならそちらに足す)。
2. **使ってよい向き**: どの領域の `index.ts` を使うか。輪にならないか。イベント(アウトボックス)で済まないか。
3. **持ち主**: どのチームが持つか。1チーム(1人)の間は聞かない(今の持ち主のまま)。チームが分かれていれば「他チームとの契約や制約」に当たるので、止まらずに仮に決め、設計書の「未確定事項」に `仮決め` で残す(CODEOWNERS は下の 12)。

## 作る物(1つの PR で)

1. `apps/api/src/domains/dependencies.ts` に1行(`<領域>: ["organizations", …]`)と、何の領域かの1行の注釈(仕様の場所)。
2. フォルダ `apps/api/src/domains/<領域>/`(既存の `projects` が最小の見本)。
   - `schema.ts`(`pgSchema("<領域>")`。無いと `domain-boundaries` が落ちる)・`repository.ts`・`index.ts`(ほかから使ってよい物だけを出す)。
   - `routes.ts` は組織の中の人が使う API があるときだけ(API の無い領域は置かない。`growth` は公開の入口だけで、組織の文脈を開く所が `src/pre-registrations/` にある)。
3. **全部の表を集める所**: `apps/api/src/db/schema.ts` に `export * from "../domains/<領域>/schema.ts";`(名前の順)。**無いと `pnpm db:generate` が「変更なし」と言い、移行ができない**。列の分類のテスト(`classification.test.ts`)もここから表を読む。
4. **ルートの登録**: API があるなら `apps/api/src/app.ts` で `index.ts` から読んで `app.route("/api", <領域>Routes)`。無いと OpenAPI に載らず、権限の表のテストも叩けない。
5. **スキーマと表の移行**: `.claude/skills/db-migration` の手順で。`schema.ts` を書いて `pnpm db:generate --name <内容>` と打つと、`CREATE SCHEMA` と表・索引は drizzle-kit が書く。手で足すのは、先頭のロック待ちの上限・`GRANT USAGE ON SCHEMA <領域> TO app_rw`・表への `GRANT`(要る操作だけ)・RLS(`ENABLE` と `FORCE ROW LEVEL SECURITY`・`tenant_isolation` のポリシー)。見本は `drizzle/0023_file_storage.sql`(新しいスキーマを作る移行。`0002_domain_schemas.sql` は表を移す移行なので見本にしない)。移行は危険度「高」(人の確認)。
6. **列の分類**: `apps/api/src/db/classification.ts` に全部の列(区分と目的)と、`pnpm docs:personal-data`(個人情報の台帳)。`personal` の列の名前が新しければ、ログで伏せる名前(`packages/logging` の `ALWAYS_REDACTED`)にも(無ければ `classification.test.ts` が落ちる)。どれも危険度「高」。
7. **解約で消す一覧**: `tenant_id` のある表を `apps/api/src/offboarding/delete-tenant.ts` の `TENANT_TABLES` に、子から親の順で(参照する側を先に。`organizations` の表より前)。無ければ `offboarding.int.test.ts` が落ちる。お客さんが持ち出すべき物なら、書き出し(`src/export/routes.ts` と `ExportSchema`)にも足すかを決める。
8. **API を足すなら**: `.claude/skills/add-api-endpoint` の手順(権限の決まり `ROUTE_RULES`・権限の表・2社のテスト・監査ログの名前)。
9. **領域の資料**: `docs/domain/<領域>/README.md` を既存の領域と同じ見出しで(エンティティ・状態・守るルール・他の領域との境目・関係するファイル・これから決めること)。用語は `docs/domain/glossary.md` に。
10. **領域ごとの CLAUDE.md**: `docs/domain/_template-CLAUDE.md` を `apps/api/src/domains/<領域>/CLAUDE.md` に写して埋める(無ければ `domain-boundaries` が落ちる)。触ってよい所・触らない所(使ってよい領域の `index.ts` だけ)・先に読む物・外との出入り(出している関数・出来事・監査ログの名前)・流すテスト。**守るルールは書き写さず README を指す**。
11. **表の説明書**: `.tbls.yml` に表ごとの1行の説明(`docs/domain/<領域>` を指す)と、`docker compose up -d` のあと `pnpm docs:db`(CI には入っていないので、手で作り直す)。
12. 持ち主: 人数が増えていれば `.github/CODEOWNERS` に `apps/api/src/domains/<領域>/` の行(危険度「高」。人が直す。PR の「人に判断してほしい所」に書く)。

## 確かめる

- `pnpm --filter @app/api test`(`domain-boundaries`: 向き・`index.ts` だけ・輪・フォルダ名 = スキーマ名・CLAUDE.md。`classification`: 分類・台帳・伏せる名前。`authz-coverage`: OpenAPI の全 API が権限の表にあるか)
- `pnpm --filter @app/api db:lint`(squawk)
- `pnpm --filter @app/api test:integration`(`rls`・`tenant-isolation`・`authz-matrix`・`classification`・`offboarding`)
- `pnpm lint`・`pnpm typecheck`

## してはいけない

- ほかの領域の表を、その領域の `index.ts` を通さずに読む
- 向きを足して輪を作る・何でも使える「共通」の領域を作る
- 領域の CLAUDE.md に、README の守るルールや apps/api の決まりを書き写す(2か所になって食い違う)
