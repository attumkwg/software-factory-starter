import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { DATA_KEY_BYTES } from "./cipher.ts";

// 組織ごとのデータ鍵を作る・開く(エンベロープ暗号化。ADR 0029)。
// データ鍵の中身は DB に置かない。KMS の鍵で包んだ物(wrapped)だけを sensitive.tenant_keys に置く。
// KMS には「この鍵は、この組織のデータ鍵」という文脈(EncryptionContext)を必ず付ける。
// 文脈は CloudTrail に残る(どの組織の鍵を・いつ・誰が開いたか)。鍵のポリシーも文脈が無い呼び出しを断る。

export type DataKey = { plain: Buffer; wrapped: string; kmsKeyId: string };

export interface KeyWrapper {
  /** 新しいデータ鍵を作り、包んだ物と一緒に返す */
  generate(tenantId: string): Promise<DataKey>;
  /** 包んだデータ鍵を開く(包んだ時と同じ組織でなければ失敗する) */
  unwrap(tenantId: string, wrapped: string, kmsKeyId: string): Promise<Buffer>;
}

/** KMS に渡す文脈(Terraform の鍵のポリシーも同じ purpose を求める) */
export const keyContext = (tenantId: string) => ({
  purpose: "tenant-data-key",
  tenant_id: tenantId,
});

/** 手元とテストの印(本物の KMS の鍵ではない)。stg・prod では使えない(config.ts) */
export const LOCAL_KEY_ID = "local";

/**
 * 本物の KMS。地域は鍵の ARN から読む。リクエストの中で呼ぶので、待つのは短く(つながらなければ 503)。
 * 呼ぶのは組織ごとに数分に1回だけ(store.ts のキャッシュ)。
 */
export function kmsKeyWrapper(keyArn: string, client?: KMSClient): KeyWrapper {
  const region = keyArn.split(":")[3];
  if (!keyArn.startsWith("arn:aws:kms:") || !region) {
    throw new Error("SENSITIVE_KMS_KEY_ID は KMS の鍵の ARN にしてください");
  }
  const kms =
    client ??
    new KMSClient({
      region,
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 2_000 },
    });
  return {
    async generate(tenantId) {
      const r = await kms.send(
        new GenerateDataKeyCommand({
          KeyId: keyArn,
          KeySpec: "AES_256",
          EncryptionContext: keyContext(tenantId),
        }),
      );
      if (!(r.Plaintext && r.CiphertextBlob)) throw new Error("KMS がデータ鍵を返しませんでした");
      return {
        plain: Buffer.from(r.Plaintext),
        wrapped: Buffer.from(r.CiphertextBlob).toString("base64"),
        kmsKeyId: keyArn,
      };
    },
    async unwrap(tenantId, wrapped, kmsKeyId) {
      if (kmsKeyId === LOCAL_KEY_ID)
        throw new Error("手元の鍵で包んだデータ鍵は、KMS では開けません");
      const r = await kms.send(
        new DecryptCommand({
          // 包んだ鍵を名指しする(暗号文の中の鍵の名前を信じない)
          KeyId: kmsKeyId,
          CiphertextBlob: Buffer.from(wrapped, "base64"),
          EncryptionContext: keyContext(tenantId),
        }),
      );
      if (!r.Plaintext) throw new Error("KMS がデータ鍵を返しませんでした");
      return Buffer.from(r.Plaintext);
    },
  };
}

// 手元の包み鍵。秘密ではない(コードに書いてある)。手元・テスト・プレビュー(本物のデータが無い所)だけで使う
const LOCAL_WRAPPING_KEY = createHash("sha256")
  .update("software-factory-starter: local sensitive wrapping key (not a secret)")
  .digest();

/** 手元・テスト・プレビュー用。KMS と同じく、包んだ時と違う組織では開けない */
export function localKeyWrapper(): KeyWrapper {
  const aad = (tenantId: string) => Buffer.from(JSON.stringify(keyContext(tenantId)));
  return {
    async generate(tenantId) {
      const plain = randomBytes(DATA_KEY_BYTES);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", LOCAL_WRAPPING_KEY, nonce, {
        authTagLength: 16,
      });
      cipher.setAAD(aad(tenantId));
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      const wrapped = Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
      return { plain, wrapped, kmsKeyId: LOCAL_KEY_ID };
    },
    async unwrap(tenantId, wrapped, kmsKeyId) {
      if (kmsKeyId !== LOCAL_KEY_ID) throw new Error("KMS で包んだデータ鍵は、手元では開けません");
      const raw = Buffer.from(wrapped, "base64");
      const decipher = createDecipheriv("aes-256-gcm", LOCAL_WRAPPING_KEY, raw.subarray(0, 12), {
        authTagLength: 16,
      });
      decipher.setAAD(aad(tenantId));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
    },
  };
}
