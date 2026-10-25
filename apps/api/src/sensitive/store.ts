import { eq } from "drizzle-orm";
import { createDb, type DbOptions, type TenantTx } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { forbidden } from "../errors.ts";
import { open, type SealContext, seal } from "./cipher.ts";
import type { KeyWrapper } from "./key-wrapper.ts";
import { tenantKeys } from "./schema.ts";

// 要配慮個人情報の読み書きの、ただ1つの入口(ADR 0029・docs/designs/0016-sensitive-data-tier1.md の 1)。
// - 接続はアプリとは別(SENSITIVE_DATABASE_URL。ロール app_sensitive)。アプリのトランザクション(c.var.tx)とは別の
//   トランザクションになる(段2で別のクラスターへ移しても、ここの作りは変わらない)。
// - 組織ごとのデータ鍵は、KMS で開いた物を数分だけメモリに置く(KMS を毎回呼ばない・トランザクションの中で待たない)。
// - 社員の代理ログインの最中は使えない(社員に要配慮の値を見せない。見せるなら、その機能の仕様で決めて関所に足す)。

/** 誰の文脈で読み書きするか(scopeOf(c) の形と同じ。support は代理ログインの最中だけある) */
export type SensitiveScope = { tenantId: string; userId: string; support?: unknown };

export type SensitiveSession = {
  /** テナントの文脈つきのトランザクション(app_sensitive の接続。スキーマ sensitive の表だけが見える) */
  tx: TenantTx;
  tenantId: string;
  /** 値を暗号化する。field は「sensitive.表.列」、rowId はその行の ID(暗号文をその行に結びつける) */
  seal(field: string, rowId: string, value: string): string;
  /** seal した値を開く。鍵が無い(消した)・別の行の物・書き換えられた物は SealedValueError */
  open(field: string, rowId: string, sealed: string): string;
};

export type SensitiveStore = {
  run<T>(scope: SensitiveScope, fn: (s: SensitiveSession) => Promise<T>): Promise<T>;
  /** メモリのデータ鍵を捨てる(鍵の行を消した後・テスト) */
  forget(tenantId: string): void;
  close(): Promise<void>;
};

export type SensitiveStoreOptions = {
  databaseUrl: string;
  wrapper: KeyWrapper;
  dbOptions?: DbOptions;
  /** データ鍵をメモリに置く時間(既定 5 分)。KMS の呼び出しの数と、消した鍵が効かなくなるまでの時間の釣り合い */
  cacheMs?: number;
  now?: () => number;
};

const FIELD = /^sensitive\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const CACHE_MS = 5 * 60_000;
// 置いておく組織の数の上限(超えたら古い物から捨てる)
const CACHE_MAX = 1_000;

export function createSensitiveStore(opts: SensitiveStoreOptions): SensitiveStore {
  const { db, pool } = createDb(opts.databaseUrl, opts.dbOptions);
  const now = opts.now ?? Date.now;
  const cacheMs = opts.cacheMs ?? CACHE_MS;
  const cache = new Map<string, { key: Buffer; expiresAt: number }>();

  const readWrapped = (tenantId: string) =>
    withTenant(db, tenantId, async (tx) => {
      const rows = await tx
        .select({ wrappedKey: tenantKeys.wrappedKey, kmsKeyId: tenantKeys.kmsKeyId })
        .from(tenantKeys)
        .where(eq(tenantKeys.tenantId, tenantId))
        .limit(1);
      return rows[0];
    });

  /** 鍵が無ければ作って足す。同時に2つが作ったら、先に入った方を使う */
  async function loadOrCreate(tenantId: string): Promise<Buffer> {
    const existing = await readWrapped(tenantId);
    if (existing) return opts.wrapper.unwrap(tenantId, existing.wrappedKey, existing.kmsKeyId);
    const fresh = await opts.wrapper.generate(tenantId);
    const inserted = await withTenant(db, tenantId, (tx) =>
      tx
        .insert(tenantKeys)
        .values({ tenantId, kmsKeyId: fresh.kmsKeyId, wrappedKey: fresh.wrapped })
        .onConflictDoNothing()
        .returning({ tenantId: tenantKeys.tenantId }),
    );
    if (inserted.length > 0) return fresh.plain;
    const winner = await readWrapped(tenantId);
    if (!winner) throw new Error("組織のデータ鍵を作れませんでした");
    return opts.wrapper.unwrap(tenantId, winner.wrappedKey, winner.kmsKeyId);
  }

  // KMS は、ここ(トランザクションの外)でだけ呼ぶ
  async function dataKey(tenantId: string): Promise<Buffer> {
    const hit = cache.get(tenantId);
    if (hit && hit.expiresAt > now()) return hit.key;
    const key = await loadOrCreate(tenantId);
    cache.delete(tenantId);
    cache.set(tenantId, { key, expiresAt: now() + cacheMs });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return key;
  }

  const contextOf = (tenantId: string, field: string, rowId: string): SealContext => {
    if (!FIELD.test(field)) throw new Error("field は「sensitive.表.列」の形にしてください");
    if (!rowId) throw new Error("rowId がありません");
    return { tenantId, field, rowId };
  };

  return {
    async run(scope, fn) {
      if (scope.support) throw forbidden();
      const key = await dataKey(scope.tenantId);
      return withTenant(db, scope.tenantId, (tx) =>
        fn({
          tx,
          tenantId: scope.tenantId,
          seal: (field, rowId, value) => seal(key, contextOf(scope.tenantId, field, rowId), value),
          open: (field, rowId, sealed) =>
            open(key, contextOf(scope.tenantId, field, rowId), sealed),
        }),
      );
    },
    forget(tenantId) {
      cache.delete(tenantId);
    },
    close: () => pool.end(),
  };
}
