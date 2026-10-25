import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "../db/columns.ts";

// 要配慮個人情報の置き場所(ADR 0018 の段1・ADR 0029・docs/designs/0016-sensitive-data-tier1.md)。
// - 読み書きは src/sensitive/ の中からだけ(Semgrep の sensitive-data-only-in-module)。接続はアプリとは別のロール
//   app_sensitive(app_rw はこのスキーマに入れない)。
// - 要配慮の値は、このモジュールが組織ごとのデータ鍵で暗号化してから書く(DB には暗号文だけ)。
// - **このスキーマの外の表へ参照(外部キー)を張らない**。段2(別のクラスター)へ移すとき、そのまま持ち出せるように。
//   解約のときは delete-tenant が tenant_id で消す(TENANT_TABLES)。

export const sensitive = pgSchema("sensitive");

/**
 * 組織ごとのデータ鍵(AES-256)。KMS の鍵で包んだ物だけを持つ(中身の鍵は DB に置かない)。
 * この行を消すと、その組織の要配慮の暗号文は読めなくなる(暗号による消去。バックアップの扱いは ADR 0029)。
 */
export const tenantKeys = sensitive.table("tenant_keys", {
  tenantId: uuid("tenant_id").primaryKey(),
  /** 包んだ KMS の鍵(ARN)。手元とテストは "local"。大きなお客さんは専用の鍵に包み直せる(T-5) */
  kmsKeyId: text("kms_key_id").notNull(),
  /** KMS が包んだデータ鍵(base64) */
  wrappedKey: text("wrapped_key").notNull(),
  createdAt: createdAt(),
});
