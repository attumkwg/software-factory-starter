import type { Context } from "hono";
import type { Config } from "../config.ts";
import type { DbOptions } from "../db/client.ts";
import type { AppEnv } from "../env.ts";
import { serviceUnavailable } from "../errors.ts";
import { kmsKeyWrapper, localKeyWrapper } from "./key-wrapper.ts";
import { createSensitiveStore, type SensitiveStore } from "./store.ts";

// 要配慮個人情報のモジュールの入口(ADR 0029)。src/sensitive/ の外からは、このファイルだけを使う
// (Semgrep の sensitive-data-only-in-module)。要配慮の表の SQL は、表ごとの関数としてこのフォルダの中に書き、
// ここから出す(領域のリポジトリには書かない)。値は出す前に開き、入れる前に閉じる(DB には暗号文だけ)。

export { SealedValueError } from "./cipher.ts";
export type { SensitiveScope, SensitiveSession, SensitiveStore } from "./store.ts";

/** 設定から作る。要配慮の接続が無ければ null(要配慮を扱わないプロダクト。段0) */
export function sensitiveStoreFromConfig(
  config: Config["sensitive"],
  dbOptions?: DbOptions,
): SensitiveStore | null {
  if (!config) return null;
  const wrapper = config.kmsKeyArn ? kmsKeyWrapper(config.kmsKeyArn) : localKeyWrapper();
  return createSensitiveStore({ databaseUrl: config.databaseUrl, wrapper, dbOptions });
}

/** ルートから使う。要配慮の接続が無い環境では 503(設定の漏れ。機能フラグより先に気づく) */
export function sensitiveOf(c: Context<AppEnv>): SensitiveStore {
  const store = c.get("sensitive");
  if (!store) throw serviceUnavailable();
  return store;
}
