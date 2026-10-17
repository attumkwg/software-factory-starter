---
name: add-api-endpoint
description: 新しい API(エンドポイント)を足すときの手順。ルート・リポジトリ・権限の決まり・権限の表(matrix.yaml)・2社のテストを1つの PR でそろえる。API を足す・変える・消すときに使う。
---

# 新しい API を足す

**API を1つ足す = 権限の表に1行足す**。表に無い API は誰も呼べない(既定は拒否)し、CI も落ちる。

## 手順

1. **仕様を確かめる**: Issue の受け入れ条件か `docs/specs/` に「誰が(ロール)・何を・他社からは?」が書いてあるか。無ければ実装せず、PR / Issue で聞く。
2. **契約**: 入力と出力のスキーマを `packages/shared/src/schemas.ts` に足す(項目は足すだけ・消さない)。
3. **リポジトリ**: `apps/api/src/repositories/` に関数を足す。
   - 引数は `TenantScope`(`scopeOf(c)`)。`tenantId` で必ず絞る(RLS に頼り切らない)。
   - 接続プール(`RootDb`)は使わない。`sql.raw` は使わない。
4. **ルート**: `apps/api/src/routes/` に `createRoute` で足す。
   - ルートの中で `role` を見ない。他社の物・無い物は `throw notFound()`。
   - 失敗の応答(`authErrors` / `notFoundError` / `badRequestError`)を付けて OpenAPI に載せる。
5. **権限の決まり**: `apps/api/src/authz/policy.ts`
   - 既存の権限で足りなければ `PERMISSIONS` に足す。
   - `ROUTE_RULES` に `"メソッド /api/パス": "権限"` を1行。
6. **権限の表**: `docs/authz/matrix.yaml` に1行。
   - `admin` / `member` / `viewer` / `anonymous` の答えを全部書く。
   - パスに ID があれば `other_tenant: 404` を必ず書く。
   - 書き込みなら `body` を書く。
7. **テスト**: 表に足せば `authz-matrix.int.test.ts` が自動で全ロールを叩く。そのうえで、業務の決まり(入力の境界・2社の分離)を `test/integration/` に足す。**テストは必ず2社**。
8. **確かめる**: `pnpm turbo run typecheck test --affected` と `pnpm test:integration`。

## PR に書くこと

- 危険度は「高」(`docs/authz` と `authz/` を触るため)。
- 「人に判断してほしい所」に、表に足した行をそのまま貼る(誰に何を許したか)。
