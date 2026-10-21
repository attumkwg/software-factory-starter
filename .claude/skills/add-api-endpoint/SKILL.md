---
name: add-api-endpoint
description: 新しい API(エンドポイント)を足すときの手順。ルート・リポジトリ・権限の決まり・権限の表(matrix.yaml)・2社のテストを1つの PR でそろえる。API を足す・変える・消すときに使う。
---

# 新しい API を足す

**API を1つ足す = 権限の表に1行足す**。表に無い API は誰も呼べない(既定は拒否)し、CI も落ちる。

## 手順

1. **仕様を確かめる**: Issue の受け入れ条件か `docs/specs/` に「誰が(ロール)・何を・他社からは?」が書いてあるか。無ければ実装せず、PR / Issue で聞く。
2. **契約**: 入力と出力のスキーマを `packages/shared/src/schemas.ts` に足す(項目は足すだけ・消さない。CI の「API の互換」が見張る。`docs/guides/api-changes.md`)。
   - 時刻は `InstantSchema`(UTC)、日付だけなら `DateOnlySchema`、お金は `MoneySchema`、単価・率は `DecimalSchema`(ADR 0005)。
3. **どの領域か決める**: `apps/api/src/domains/<領域>/`(organizations・projects・tasks。`docs/domain/` と同じ名前)。
   - ほかの領域のデータが要るなら、その領域の `index.ts` の関数を使う(無ければそちらに足して export)。表を直接読まない。
   - 新しい向き(A → B)が要るなら `domains/dependencies.ts` に足す。輪(A → B → A)は作らない。迷ったら出来事(アウトボックス)で済まないか考える。
4. **リポジトリ**: `apps/api/src/domains/<領域>/repository.ts` に関数を足す。
   - 引数は `TenantScope`(`scopeOf(c)`)。`tenantId` で必ず絞る(RLS に頼り切らない)。
   - 接続プール(`RootDb`)は使わない。`sql.raw` は使わない。
   - **一覧は必ずページング**(`docs/guides/api-changes.md`「一覧は必ずページング」)。全件を返さない。`src/db/paging.ts` の `decodeCursor` / `cursorTime` / `beyondCursor` / `toPage` で、並びは「作った時刻+ID」、`limit + 1` 件読む(`domains/projects/repository.ts` の `listProjects` が見本)。並びと同じ索引が無ければ張る(`/db-migration`)。
5. **ルート**: `apps/api/src/domains/<領域>/routes.ts` に `createRoute` で足す。
   - ルートの中で `role` を見ない。他社の物・無い物は `throw notFound()`。
   - 失敗の応答(`authErrors` / `notFoundError` / `badRequestError`)を付けて OpenAPI に載せる。
   - 一覧なら `request: { query: PageQuery }`(`http/common.ts`)と、応答は `{ <名前>: [...], nextCursor }` のスキーマ(`packages/shared` の `ProjectPageSchema` が見本)。
   - 起きたことをほかへ知らせるなら、同じトランザクションで `enqueue(scope, "<領域>.<出来事>", {...})`(`src/outbox/topics.ts` に足す。ADR 0006)。
6. **権限の決まり**: `apps/api/src/authz/policy.ts`
   - 既存の権限で足りなければ `PERMISSIONS` に足す。
   - `ROUTE_RULES` に `"メソッド /api/パス": "権限"` を1行。
   - **書き込み(GET 以外)なら、監査ログの名前**を `apps/api/src/audit/actions.ts` に1行(`"POST /api/…": { action: "対象.動作", target: "対象" }`)。記録は認可の関所が自動で取る。無ければ `audit-coverage.test.ts` が落ちる。画面の文は `apps/web/src/audit-labels.ts`。**一度使った名前は変えない**。
7. **権限の表**: `docs/authz/matrix.yaml` に1行。
   - `admin` / `member` / `viewer` / `anonymous` の答えを全部書く。
   - パスに ID があれば `other_tenant: 404` を必ず書く。
   - 書き込みなら `body` を書く。
8. **個人情報**: 返す値・ログに出す項目・出来事の中身を、列の分類表(`apps/api/src/db/classification.ts`。台帳は `docs/db/personal-data.md`)で確かめる。
   - `personal` / `sensitive` の値は、ログ・監査ログの `details`・出来事の中身(`enqueue`)に入れない。ログは `{ taskId }` のような ID と数だけ。出来事は ID だけ(受け手が DB から読み直す)。
   - パスに新しい ID(`{fooId}`)を足したら、分類表の `platform.audit_events.details` の keys に足す。出来事の中身のキーを足したら `platform.outbox.payload` の keys に足す(無ければ `classification.test.ts` が落ちる)。
   - `sensitive` の値を返す API は、この手順だけで足さない(ADR 0018。人の確認が要る)。
9. **テスト**: 一覧なら、続きの印をたどって抜けも重なりも無く最後まで読めること・上限を超える `limit` が 400 になることも(`performance.int.test.ts` が見本)。表に足せば `authz-matrix.int.test.ts` が自動で全ロールを叩く。そのうえで、業務の決まり(入力の境界・2社の分離)を `test/integration/` に足す。**テストは必ず2社**。
10. **確かめる**: `pnpm turbo run typecheck test --affected` と `pnpm test:integration`。

## PR に書くこと

- 危険度は「高」(`docs/authz` と `authz/` を触るため)。
- 「人に判断してほしい所」に、表に足した行をそのまま貼る(誰に何を許したか)。
