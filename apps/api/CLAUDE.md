# apps/api のルール

- 入口: `src/app.ts`(組み立て)・`src/index.ts`(起動と SIGTERM)・`src/cli.ts`(移行・種データ)
- リクエストの流れ: request ID → セッションを読む(`auth/`)→ **認可の関所**(`authz/middleware.ts`)→ ルート → リポジトリ
- 認可の決まりは `src/authz/policy.ts` の1か所だけ。ルートの中で `role` を見て分岐しない。
- ルート(`src/routes`)は入力と出力の形だけ。DB の読み書きは `src/repositories` に書き、`scopeOf(c)` を渡す。
- リポジトリは RLS に頼り切らず、`tenantId` でも絞る(層を重ねる)。
- 他社の物・無い物は 404。権限が無ければ 403。ログインしていなければ 401。
- 入力は Zod で検証(`@app/shared` のスキーマを使う)。`sql.raw` は使わない。
- テストは必ず2社で書く(`test/helpers/fixtures.ts` の `createTenantFixture`)。
- 単体は `test/unit`(DB 無し)、DB が要るものは `test/integration/*.int.test.ts`(Testcontainers)。
