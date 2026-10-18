# apps/api のルール

- 入口: `src/app.ts`(組み立て)・`src/index.ts`(起動と SIGTERM)・`src/cli.ts`(移行・種データ)
- リクエストの流れ: request ID → セッションを読む(`auth/`)→ **認可の関所**(`authz/middleware.ts`)→ ルート → リポジトリ
- 認可の決まりは `src/authz/policy.ts` の1か所だけ。ルートの中で `role` を見て分岐しない。
- 「このデータに触ってよいか」(自分が作った物だけ消せる、など)も `policy.ts` に足し、データを読んだ後に `can(actor, 操作, データ)` の形で聞く。足したら `docs/authz/matrix.yaml` に「自分の物 / 同じ会社の他人の物 / 他社の物」の答えも書く。
- **領域ごとに分ける**(ADR 0004): `src/domains/<領域>/{schema,repository,routes,index}.ts`。ほかの領域・共通部分からは `index.ts` だけを使う。使ってよい向きは `src/domains/dependencies.ts`(破ると `test/unit/domain-boundaries.test.ts` が落ちる)。表は領域の名前の Postgres のスキーマに置く。
- ルート(`routes.ts`)は入力と出力の形だけ。DB の読み書きは `repository.ts` に書き、`scopeOf(c)` を渡す。
- 共通の部品: `src/http/common.ts`(OpenAPI の応答・本文)・`src/db/`(接続・テナント・列の作り方)・`src/outbox/`(送信待ち)。
- **お金と時刻**(ADR 0005): 金額は最小単位の整数+通貨、単価・率は小数の文字列、計算は `@app/shared` の `money.ts`(丸め方を必ず渡す)。時刻は UTC で持ち、日付だけの値は `date`。「1日」の区切りは組織の時間帯(`tenants.time_zone`・`time.ts` の `localDayRange`)。
- **起きたことをほかへ知らせる**(ADR 0006): 外へ直接送らず、同じトランザクションで `enqueue()`。受け手は同じ出来事が2回届いても大丈夫に書く。
- **メール**(ADR 0008): リクエストの中で直接送らない。出来事を積み、受け手(`outbox/handlers.ts`)で組み立てて `mailer.send()`。宛先は送る直前に DB から読む(出来事にメールアドレスを入れない)。手順は `docs/guides/mail.md`。
- リポジトリは RLS に頼り切らず、`tenantId` でも絞る(層を重ねる)。
- 他社の物・無い物は 404。権限が無ければ 403。ログインしていなければ 401。
- 失敗は投げるだけ(`errors.ts` の関数)。ルートで try/catch して形を作らない。`onError` が code に直し、ログは `logger.error({ err }, "…")` の形だけ(SQL の値が落ちる)。決まりは `docs/guides/error-handling.md`。
- 入力は Zod で検証(`@app/shared` のスキーマを使う)。`sql.raw` は使わない。
- テストは必ず2社で書く(`test/helpers/fixtures.ts` の `createTenantFixture`)。
- 単体は `test/unit`(DB 無し)、DB が要るものは `test/integration/*.int.test.ts`(Testcontainers)。
