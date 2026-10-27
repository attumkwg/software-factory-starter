import { objectKey, tenantPrefixes } from "../../src/storage/keys.ts";
import type { ObjectStore } from "../../src/storage/object-store.ts";

// テストの置き場(メモリの中)。キーは本物と同じ関数で作り、URL は「どのキーを指したか」が読める偽物。
// 本物と同じ取り決め(署名・版)の確かめは files-object-store.int.test.ts(RustFS)。

export type MemoryObjectStore = ObjectStore & {
  objects: Map<string, { body: Uint8Array; contentType?: string; contentDisposition?: string }>;
  /** 画面が PUT した代わり(上げた物を置く) */
  upload(tenantId: string, fileId: string, body: Uint8Array): void;
  /** 署名した URL が指したキー(呼んだ順) */
  signedKeys: string[];
};

export function memoryObjectStore(): MemoryObjectStore {
  const objects: MemoryObjectStore["objects"] = new Map();
  const signedKeys: string[] = [];
  const expiresAt = () => new Date(Date.now() + 300_000);
  const sign = (key: string) => {
    signedKeys.push(key);
    return `https://files.test/${key}?X-Amz-Signature=fake`;
  };
  return {
    objects,
    signedKeys,
    upload(tenantId, fileId, body) {
      objects.set(objectKey("incoming", tenantId, fileId), { body });
    },
    async presignUpload(tenantId, fileId, file) {
      return {
        url: sign(objectKey("incoming", tenantId, fileId)),
        expiresAt: expiresAt(),
        headers: { "Content-Type": file.contentType, "Content-Length": String(file.byteSize) },
      };
    },
    async presignDownload(tenantId, fileId) {
      return { url: sign(objectKey("files", tenantId, fileId)), expiresAt: expiresAt() };
    },
    async readIncoming(tenantId, fileId, maxBytes) {
      const o = objects.get(objectKey("incoming", tenantId, fileId));
      if (!o) return null;
      return o.body.length > maxBytes ? { tooLarge: o.body.length } : { body: o.body };
    },
    async writeFile(tenantId, fileId, body, meta) {
      objects.set(objectKey("files", tenantId, fileId), { body, ...meta });
    },
    async remove(tenantId, fileId) {
      objects.delete(objectKey("incoming", tenantId, fileId));
      objects.delete(objectKey("files", tenantId, fileId));
    },
    async removeIncoming(tenantId, fileId) {
      objects.delete(objectKey("incoming", tenantId, fileId));
    },
    async purgeTenant(tenantId, { dryRun }) {
      const keys = [...objects.keys()].filter((k) =>
        tenantPrefixes(tenantId).some((p) => k.startsWith(p)),
      );
      if (!dryRun) for (const k of keys) objects.delete(k);
      return keys.length;
    },
  };
}
