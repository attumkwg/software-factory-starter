import { FILE_LIMITS, type FileContentType } from "@app/shared";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { objectKey, tenantPrefixes } from "./keys.ts";
import type { TenantCredentials } from "./tenant-credentials.ts";

// 置き場(S3。手元は S3 互換の RustFS)と話すのはここだけ(docs/designs/0072-file-storage.md の 1・ADR 0079)。
// どの操作も組織の ID を受け、その組織だけに絞った権限(tenant-credentials.ts)で S3 を呼ぶ。キーは keys.ts からだけ。
// 署名つき URL・キーはログに出さない(URL には署名が入る)。

export type SignedUrl = { url: string; expiresAt: Date };

export type ObjectStore = {
  /** incoming/<組織>/<ファイル> への PUT の URL。種類と大きさを署名に入れる(違う物は S3 が 403) */
  presignUpload(
    tenantId: string,
    fileId: string,
    file: { contentType: FileContentType; byteSize: number },
  ): Promise<
    SignedUrl & { headers: { "Content-Type": FileContentType; "Content-Length": string } }
  >;
  /** files/<組織>/<ファイル> への GET の URL */
  presignDownload(tenantId: string, fileId: string): Promise<SignedUrl>;
  /** 上げた物を読む。無ければ null。maxBytes を超えていれば読まずに too_large */
  readIncoming(
    tenantId: string,
    fileId: string,
    maxBytes: number,
  ): Promise<{ body: Uint8Array } | { tooLarge: number } | null>;
  /** 見せる物を書く */
  writeFile(
    tenantId: string,
    fileId: string,
    body: Uint8Array,
    meta: { contentType: FileContentType; contentDisposition: string },
  ): Promise<void>;
  /** 1つのファイルの今の版を消す(incoming と files の両方。無くても成功。前の版はライフサイクルで消える) */
  remove(tenantId: string, fileId: string): Promise<void>;
  /** incoming だけを消す(書き直した後・断った後) */
  removeIncoming(tenantId: string, fileId: string): Promise<void>;
  /** 組織の置き場の中身を前の版も含めて数える・消す(解約の削除。dryRun なら数えるだけ) */
  purgeTenant(tenantId: string, opts: { dryRun: boolean }): Promise<number>;
};

export type S3StoreOptions = {
  bucket: string;
  region: string;
  credentials: TenantCredentials;
  /** 手元・テスト(RustFS)だけ: API から届く入口 */
  endpoint?: string | undefined;
  /** 手元だけ: ブラウザから届く入口(署名に入るので、URL を作るときはこちら) */
  publicEndpoint?: string | undefined;
  now?: () => number;
};

export function s3ObjectStore(opts: S3StoreOptions): ObjectStore {
  const { bucket } = opts;
  const now = opts.now ?? Date.now;
  const ttl = FILE_LIMITS.urlTtlSeconds;

  const clientFor = (tenantId: string, endpoint: string | undefined) =>
    new S3Client({
      region: opts.region,
      credentials: () => opts.credentials.forTenant(tenantId),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      // 署名つき URL に空の本文のチェックサムを入れない(入れると、画面が上げる中身と合わず断られる)
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  const api = (tenantId: string) => clientFor(tenantId, opts.endpoint);
  const browser = (tenantId: string) => clientFor(tenantId, opts.publicEndpoint ?? opts.endpoint);
  const expiresAt = () => new Date(now() + ttl * 1000);

  return {
    async presignUpload(tenantId, fileId, file) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey("incoming", tenantId, fileId),
        ContentType: file.contentType,
        ContentLength: file.byteSize,
      });
      const url = await getSignedUrl(browser(tenantId), command, {
        expiresIn: ttl,
        signableHeaders: new Set(["content-type", "content-length"]),
      });
      return {
        url,
        expiresAt: expiresAt(),
        headers: { "Content-Type": file.contentType, "Content-Length": String(file.byteSize) },
      };
    },

    async presignDownload(tenantId, fileId) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey("files", tenantId, fileId),
      });
      const url = await getSignedUrl(browser(tenantId), command, { expiresIn: ttl });
      return { url, expiresAt: expiresAt() };
    },

    readIncoming: (tenantId, fileId, maxBytes) =>
      readUpTo(api(tenantId), bucket, objectKey("incoming", tenantId, fileId), maxBytes),

    async writeFile(tenantId, fileId, body, meta) {
      await api(tenantId).send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey("files", tenantId, fileId),
          Body: body,
          ContentType: meta.contentType,
          ContentDisposition: meta.contentDisposition,
        }),
      );
    },

    async remove(tenantId, fileId) {
      const client = api(tenantId);
      for (const stage of ["incoming", "files"] as const) {
        await deleteKey(client, bucket, objectKey(stage, tenantId, fileId));
      }
    },

    removeIncoming: (tenantId, fileId) =>
      deleteKey(api(tenantId), bucket, objectKey("incoming", tenantId, fileId)),

    async purgeTenant(tenantId, { dryRun }) {
      const client = api(tenantId);
      let count = 0;
      for (const prefix of tenantPrefixes(tenantId)) {
        count += await purgePrefix(client, bucket, prefix, dryRun);
      }
      return count;
    },
  };
}

async function deleteKey(client: S3Client, bucket: string, key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** 読む。無ければ null。maxBytes を超えていれば読まずに tooLarge */
async function readUpTo(
  client: S3Client,
  bucket: string,
  key: string,
  maxBytes: number,
): Promise<{ body: Uint8Array } | { tooLarge: number } | null> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const size = res.ContentLength ?? 0;
    if (size > maxBytes) {
      await res.Body?.transformToWebStream().cancel();
      return { tooLarge: size };
    }
    const body = await res.Body?.transformToByteArray();
    return body ? { body } : null;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** 頭が prefix の物を、前の版と消した印も含めて数える・消す。数を返す */
async function purgePrefix(
  client: S3Client,
  bucket: string,
  prefix: string,
  dryRun: boolean,
): Promise<number> {
  let count = 0;
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  do {
    const page = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
        MaxKeys: 1000,
      }),
    );
    const targets = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
      .filter((v): v is { Key: string; VersionId?: string } => !!v.Key?.startsWith(prefix))
      .map((v) => ({ Key: v.Key, VersionId: v.VersionId }));
    count += targets.length;
    if (!dryRun) await deleteVersions(client, bucket, targets);
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);
  return count;
}

async function deleteVersions(
  client: S3Client,
  bucket: string,
  targets: { Key: string; VersionId: string | undefined }[],
): Promise<void> {
  if (targets.length === 0) return;
  const res = await client.send(
    new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: targets, Quiet: true } }),
  );
  if (res.Errors && res.Errors.length > 0) {
    throw new Error(`置き場の中身を ${res.Errors.length} 件消せませんでした`);
  }
}

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string }).name;
  return name === "NoSuchKey" || name === "NotFound";
}
