// すべての領域の表(drizzle の型と移行の生成に使う)。表を書く場所は src/domains/<領域>/schema.ts。
// ルール(docs/adr/0001・0004):
// - 全テーブルに tenant_id。RLS は移行(drizzle/0001_rls.sql など)で有効化する。
// - 新しい表を足したら、同じ PR で RLS の移行も足す(結合テスト「全テーブルに RLS」が落ちる)。
// - 表どうしの参照は (tenant_id, id) の組で張り、別テナントの行を指せないようにする。
// - 領域ごとに Postgres のスキーマを分ける。ほかの領域の表を読むときは、その領域の index.ts の関数を通す。

export * from "../audit/schema.ts";
export * from "../domains/legal/schema.ts";
export * from "../domains/organizations/schema.ts";
export * from "../domains/projects/schema.ts";
export * from "../domains/tasks/schema.ts";
export * from "../feature-flags/schema.ts";
// 領域ではない共通の仕組み(スキーマ platform)
export * from "../outbox/schema.ts";
export * from "../pmf-survey/schema.ts";
// 要配慮個人情報(スキーマ sensitive。ADR 0018・0029)。型と移行の生成のためだけにここで集める。
// アプリの接続(app_rw)はこのスキーマに入れないので、ここ経由で読もうとしても DB が断る
export * from "../sensitive/schema.ts";
export * from "../usage/schema.ts";
