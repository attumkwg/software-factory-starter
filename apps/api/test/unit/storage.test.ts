import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { objectKey, tenantPrefixes } from "../../src/storage/keys.ts";
import { s3ObjectStore } from "../../src/storage/object-store.ts";
import {
  staticTenantCredentials,
  stsTenantCredentials,
  tenantSessionPolicy,
} from "../../src/storage/tenant-credentials.ts";

// 写真・ファイルの置き場(docs/designs/0072-file-storage.md)。S3 を呼ばずに確かめられる所。
// 本物と同じ取り決めの置き場(RustFS)での確かめは test/integration/files-object-store.int.test.ts。

const A = "0190a1b2-0000-7000-8000-00000000000a";
const B = "0190a1b2-0000-7000-8000-00000000000b";
const F = "0190a1b2-0000-7000-8000-0000000000f1";

describe("置き場のキー(keys.ts)", () => {
  it("<段>/<組織の ID>/<ファイルの ID>", () => {
    expect(objectKey("incoming", A, F)).toBe(`incoming/${A}/${F}`);
    expect(objectKey("files", A, F)).toBe(`files/${A}/${F}`);
    expect(tenantPrefixes(A)).toEqual([`incoming/${A}/`, `files/${A}/`]);
  });

  it.each(["../x", `${A}/..`, "", "A".repeat(36), `${A.toUpperCase()}`])(
    "UUID の形でない ID(%s)では作らない",
    (bad) => {
      expect(() => objectKey("files", bad, F)).toThrow(/置き場のキー/);
      expect(() => objectKey("files", A, bad)).toThrow(/置き場のキー/);
      expect(() => tenantPrefixes(bad)).toThrow(/置き場のキー/);
    },
  );
});

describe("組織ごとに絞った権限(tenant-credentials.ts)", () => {
  it("セッションのポリシーは、その組織のキーの頭だけを許す", () => {
    const policy = JSON.parse(tenantSessionPolicy("bucket-1", A)) as {
      Statement: { Resource: string | string[]; Condition?: unknown }[];
    };
    const text = JSON.stringify(policy);
    expect(text).toContain(`arn:aws:s3:::bucket-1/incoming/${A}/*`);
    expect(text).toContain(`arn:aws:s3:::bucket-1/files/${A}/*`);
    expect(text).not.toContain(B);
    // 「バケット全部」の物の権限は無い(一覧だけがバケットに付き、頭の条件つき)
    const objectResources = policy.Statement.flatMap((s) => s.Resource);
    expect(objectResources).not.toContain("arn:aws:s3:::bucket-1/*");
    expect(policy.Statement.find((s) => s.Resource === "arn:aws:s3:::bucket-1")?.Condition).toEqual(
      { StringLike: { "s3:prefix": [`incoming/${A}/*`, `files/${A}/*`] } },
    );
  });

  it("STS は組織ごとに1回だけ呼び、期限の10分前に取り直す", async () => {
    let clock = Date.parse("2026-10-27T00:00:00Z");
    const send = vi.fn(async (cmd: { input: { RoleSessionName: string; Policy: string } }) => ({
      Credentials: {
        AccessKeyId: cmd.input.RoleSessionName,
        SecretAccessKey: "s",
        SessionToken: "t",
        Expiration: new Date(clock + 60 * 60 * 1000),
      },
    }));
    const creds = stsTenantCredentials({
      sts: { send } as never,
      roleArn: "arn:aws:iam::123456789012:role/files-access",
      bucket: "bucket-1",
      now: () => clock,
    });
    const [a1, a2, b1] = await Promise.all([
      creds.forTenant(A),
      creds.forTenant(A),
      creds.forTenant(B),
    ]);
    expect(a1.accessKeyId).toBe(`files-${A}`);
    expect(a2).toBe(a1);
    expect(b1.accessKeyId).toBe(`files-${B}`);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0].input.Policy).toBe(tenantSessionPolicy("bucket-1", A));

    clock += 49 * 60 * 1000; // 残り11分: まだ使う
    await creds.forTenant(A);
    expect(send).toHaveBeenCalledTimes(2);
    clock += 2 * 60 * 1000; // 残り9分: 取り直す
    await creds.forTenant(A);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("STS が失敗したら覚えず、次で取り直す", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("throttled"))
      .mockResolvedValue({
        Credentials: {
          AccessKeyId: "k",
          SecretAccessKey: "s",
          SessionToken: "t",
          Expiration: new Date(Date.now() + 3600_000),
        },
      });
    const creds = stsTenantCredentials({ sts: { send }, roleArn: "arn", bucket: "b" });
    await expect(creds.forTenant(A)).rejects.toThrow("throttled");
    await expect(creds.forTenant(A)).resolves.toMatchObject({ accessKeyId: "k" });
  });
});

describe("署名つき URL(object-store.ts)", () => {
  const forTenant = vi.fn(async (_tenantId: string) => ({
    accessKeyId: "minio",
    secretAccessKey: "minio-secret",
  }));
  const store = s3ObjectStore({
    bucket: "files-test",
    region: "us-east-1",
    credentials: { forTenant },
    endpoint: "http://minio:9000",
    publicEndpoint: "http://localhost:9000",
    now: () => Date.parse("2026-10-27T00:00:00Z"),
  });

  it("上げる URL は incoming/<組織>/<ファイル> を指し、種類と大きさを署名に入れる", async () => {
    const signed = await store.presignUpload(A, F, { contentType: "image/jpeg", byteSize: 1234 });
    const url = new URL(signed.url);
    expect(url.origin).toBe("http://localhost:9000");
    expect(url.pathname).toBe(`/files-test/incoming/${A}/${F}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";").sort()).toEqual([
      "content-length",
      "content-type",
      "host",
    ]);
    // 空の本文のチェックサムを入れない(入れると上げる中身と合わない)
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().includes("checksum"))).toBe(
      false,
    );
    expect(signed.headers).toEqual({ "Content-Type": "image/jpeg", "Content-Length": "1234" });
    expect(signed.expiresAt.toISOString()).toBe("2026-10-27T00:05:00.000Z");
    expect(forTenant).toHaveBeenLastCalledWith(A);
  });

  it("見る URL は files/<組織>/<ファイル> を指し、名前を URL に入れない", async () => {
    const signed = await store.presignDownload(B, F);
    const url = new URL(signed.url);
    expect(url.pathname).toBe(`/files-test/files/${B}/${F}`);
    expect(url.searchParams.has("response-content-disposition")).toBe(false);
    expect(forTenant).toHaveBeenLastCalledWith(B);
  });
});

describe("置き場の設定", () => {
  const base = { DATABASE_URL: "postgres://x", SESSION_SECRET: "s".repeat(32) };
  const minio = {
    FILES_BUCKET: "files-local",
    FILES_S3_ENDPOINT: "http://minio:9000",
    FILES_S3_ACCESS_KEY: "minio",
    FILES_S3_SECRET_KEY: "minio-secret",
  };

  it("置き場の名前が無ければ使わない", () => {
    expect(loadConfig({ ...base, APP_ENV: "local" }).files).toBeNull();
  });

  it("手元の S3 互換の置き場の入口と鍵は、手元とテストだけ", () => {
    expect(loadConfig({ ...base, ...minio, APP_ENV: "local" }).files).toMatchObject({
      bucket: "files-local",
      endpoint: "http://minio:9000",
      staticCredentials: { accessKeyId: "minio" },
    });
    expect(() => loadConfig({ ...base, ...minio, APP_ENV: "preview" })).toThrow(
      /FILES_S3_ENDPOINT/,
    );
  });

  it("本物の環境は組織ごとに絞る役割が要る", () => {
    expect(() => loadConfig({ ...base, APP_ENV: "preview", FILES_BUCKET: "files-b" })).toThrow(
      /FILES_ACCESS_ROLE_ARN/,
    );
    const role = "arn:aws:iam::123456789012:role/files-access";
    expect(
      loadConfig({
        ...base,
        APP_ENV: "preview",
        FILES_BUCKET: "files-b",
        FILES_ACCESS_ROLE_ARN: role,
      }).files,
    ).toMatchObject({ accessRoleArn: role, staticCredentials: null });
  });

  it("手元でも鍵か役割のどちらかが要る", () => {
    expect(() => loadConfig({ ...base, APP_ENV: "local", FILES_BUCKET: "files-b" })).toThrow(
      /FILES_S3_ACCESS_KEY/,
    );
  });

  it("固定の鍵の置き場は、組織ごとに絞らない(手元だけ)", async () => {
    const creds = staticTenantCredentials({ accessKeyId: "k", secretAccessKey: "s" });
    expect(await creds.forTenant(A)).toEqual(await creds.forTenant(B));
  });
});
