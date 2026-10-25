import { randomBytes } from "node:crypto";
import type { KMSClient } from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";
import { open, type SealContext, SealedValueError, seal } from "../../src/sensitive/cipher.ts";
import { sensitiveOf, sensitiveStoreFromConfig } from "../../src/sensitive/index.ts";
import {
  keyContext,
  kmsKeyWrapper,
  LOCAL_KEY_ID,
  localKeyWrapper,
} from "../../src/sensitive/key-wrapper.ts";

// 要配慮個人情報の暗号化の部品(ADR 0029・docs/designs/0016-sensitive-data-tier1.md の 6)。DB は使わない。
// DB とつないだ読み書き・ロールの分け方は test/integration/sensitive.int.test.ts。

const A = "0190a000-0000-7000-8000-00000000000a";
const B = "0190b000-0000-7000-8000-00000000000b";
const ctx: SealContext = { tenantId: A, field: "sensitive.health.diagnosis", rowId: "row-1" };

describe("値の暗号化(cipher.ts)", () => {
  const key = randomBytes(32);

  it("閉じた値は同じ鍵・同じ文脈で開ける。暗号文に元の値は入らない。毎回違う暗号文になる", () => {
    const sealed = seal(key, ctx, "持病: ぜんそく");
    expect(sealed).toMatch(/^s1\./);
    expect(sealed).not.toContain("ぜんそく");
    expect(seal(key, ctx, "持病: ぜんそく")).not.toBe(sealed);
    expect(open(key, ctx, sealed)).toBe("持病: ぜんそく");
  });

  it("別の組織・別の列・別の行へ写した暗号文は開けない", () => {
    const sealed = seal(key, ctx, "x");
    for (const other of [
      { ...ctx, tenantId: B },
      { ...ctx, field: "sensitive.health.note" },
      { ...ctx, rowId: "row-2" },
    ]) {
      expect(() => open(key, other, sealed)).toThrow(SealedValueError);
    }
  });

  it("鍵が違う・書き換えた・形が違う暗号文は開けない(中身の手がかりを出さない)", () => {
    const sealed = seal(key, ctx, "x");
    expect(() => open(randomBytes(32), ctx, sealed)).toThrow(SealedValueError);
    const parts = sealed.split(".");
    const body = Buffer.from(parts[2] ?? "", "base64url");
    body[0] = (body[0] ?? 0) ^ 1;
    parts[2] = body.toString("base64url");
    expect(() => open(key, ctx, parts.join("."))).toThrow(SealedValueError);
    for (const bad of ["", "x", "s2.a.b.c", "s1.a.b"]) {
      expect(() => open(key, ctx, bad)).toThrow(SealedValueError);
    }
    expect(() => open(key, ctx, sealed)).not.toThrow();
  });

  it("データ鍵は32バイトだけ", () => {
    expect(() => seal(randomBytes(16), ctx, "x")).toThrow(/32/);
  });
});

describe("データ鍵の包み方(key-wrapper.ts)", () => {
  it("手元の包み鍵: 作った組織でだけ開ける。KMS で包んだ物は開かない", async () => {
    const w = localKeyWrapper();
    const k = await w.generate(A);
    expect(k.kmsKeyId).toBe(LOCAL_KEY_ID);
    expect(k.plain).toHaveLength(32);
    expect(k.wrapped).not.toContain(k.plain.toString("base64"));
    expect(await w.unwrap(A, k.wrapped, k.kmsKeyId)).toEqual(k.plain);
    await expect(w.unwrap(B, k.wrapped, k.kmsKeyId)).rejects.toThrow();
    await expect(w.unwrap(A, k.wrapped, "arn:aws:kms:x")).rejects.toThrow(/手元では開けません/);
  });

  it("KMS: 組織の文脈を付けて呼び、包んだ鍵を名指しして開く", async () => {
    const arn = "arn:aws:kms:ap-northeast-1:123456789012:key/abcd";
    const plain = randomBytes(32);
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const fake = {
      send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        calls.push({ name: cmd.constructor.name, input: cmd.input });
        return cmd.constructor.name === "GenerateDataKeyCommand"
          ? { Plaintext: plain, CiphertextBlob: Buffer.from("wrapped") }
          : { Plaintext: plain };
      },
    } as unknown as KMSClient;
    const w = kmsKeyWrapper(arn, fake);
    const k = await w.generate(A);
    expect(k).toEqual({ plain, wrapped: Buffer.from("wrapped").toString("base64"), kmsKeyId: arn });
    expect(await w.unwrap(A, k.wrapped, arn)).toEqual(plain);
    expect(calls).toEqual([
      {
        name: "GenerateDataKeyCommand",
        input: { KeyId: arn, KeySpec: "AES_256", EncryptionContext: keyContext(A) },
      },
      {
        name: "DecryptCommand",
        input: {
          KeyId: arn,
          CiphertextBlob: Buffer.from("wrapped"),
          EncryptionContext: { purpose: "tenant-data-key", tenant_id: A },
        },
      },
    ]);
    await expect(w.unwrap(A, k.wrapped, LOCAL_KEY_ID)).rejects.toThrow(/KMS では開けません/);
  });

  it("KMS の鍵は ARN だけ(地域を ARN から読む)", () => {
    expect(() => kmsKeyWrapper("alias/sensitive")).toThrow(/ARN/);
  });
});

describe("入口(index.ts)", () => {
  it("設定が無ければ null(段0)。あれば手元の包み鍵の入口を作る(つなぐのは使うとき)", async () => {
    expect(sensitiveStoreFromConfig(null)).toBeNull();
    const store = sensitiveStoreFromConfig({
      databaseUrl: "postgres://app_sensitive_login@localhost:1/app",
      kmsKeyArn: null,
    });
    expect(store).not.toBeNull();
    await store?.close();
  });

  it("ルートから使うとき、要配慮の接続が無い環境では 503", () => {
    const c = { get: () => null } as unknown as Parameters<typeof sensitiveOf>[0];
    expect(() => sensitiveOf(c)).toThrow(expect.objectContaining({ status: 503 }));
  });
});
