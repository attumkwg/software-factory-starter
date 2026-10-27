import {
  CreateBucketCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { objectKey } from "../../src/storage/keys.ts";
import { ensureLocalBucket } from "../../src/storage/local-bucket.ts";
import { type ObjectStore, s3ObjectStore } from "../../src/storage/object-store.ts";
import { staticTenantCredentials } from "../../src/storage/tenant-credentials.ts";

// 写真・ファイルの置き場を、本物と同じ取り決め(S3 の SigV4・版)で話す置き場に向けて確かめる
// (docs/specs/0072-file-storage.md・ADR 0079)。RLS の外の一番の漏えいの道なので、署名の書き換えが断られることを見る。
// 置き場は RustFS(S3 互換・Apache-2.0。MinIO は公式のイメージの配布をやめた)。組織ごとに絞る権限(STS)の効き目は
// ここでは確かめない(固定の鍵)。中身はポリシーの単体テスト・効き目は stg(docs/runbooks/file-storage.md)。

// 版とダイジェストを固定する(Renovate が上げる)
const OBJECT_STORE_IMAGE =
  "rustfs/rustfs:1.0.1@sha256:1803faef57627e2d9c2e7d89d655d712ddded5389040054987163043fecb6a3c";
const KEYS = { accessKeyId: "rustfs-test", secretAccessKey: "rustfs-test-secret" };
const BUCKET = "files-test";

const A = "0190a1b2-0000-7000-8000-00000000000a";
const B = "0190a1b2-0000-7000-8000-00000000000b";
const fileId = () => crypto.randomUUID();

let container: StartedTestContainer;
let endpoint: string;
let admin: S3Client;
let store: ObjectStore;

beforeAll(async () => {
  container = await new GenericContainer(OBJECT_STORE_IMAGE)
    .withEnvironment({
      RUSTFS_ACCESS_KEY: KEYS.accessKeyId,
      RUSTFS_SECRET_KEY: KEYS.secretAccessKey,
    })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  admin = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: KEYS,
  });
  await waitUntilReady(() => admin.send(new CreateBucketCommand({ Bucket: BUCKET })));
  await admin.send(
    new PutBucketVersioningCommand({
      Bucket: BUCKET,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  store = s3ObjectStore({
    bucket: BUCKET,
    region: "us-east-1",
    credentials: staticTenantCredentials(KEYS),
    endpoint,
  });
}, 180_000);

afterAll(async () => {
  admin?.destroy();
  await container?.stop();
});

/** 起動の直後は少しの間 503 を返すことがある */
async function waitUntilReady(fn: () => Promise<unknown>) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 30) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

async function put(url: string, body: Uint8Array, contentType: string) {
  return fetch(url, { method: "PUT", body, headers: { "Content-Type": contentType } });
}

describe("上げる URL", () => {
  it("署名どおりの種類と大きさなら上げられ、incoming/<組織>/<ファイル> に置かれる", async () => {
    const id = fileId();
    const signed = await store.presignUpload(A, id, { contentType: "image/jpeg", byteSize: 1234 });
    const res = await put(signed.url, bytes(1234), "image/jpeg");
    expect(res.status, await res.text()).toBe(200);
    const read = await store.readIncoming(A, id, 2000);
    expect(read && "body" in read ? read.body.length : null).toBe(1234);
  });

  it("言った大きさと違う物・違う種類は、置き場が断る", async () => {
    const id = fileId();
    const signed = await store.presignUpload(A, id, { contentType: "image/jpeg", byteSize: 1234 });
    expect((await put(signed.url, bytes(1235), "image/jpeg")).status).toBe(403);
    expect((await put(signed.url, bytes(1234), "text/html")).status).toBe(403);
    expect(await store.readIncoming(A, id, 2000)).toBeNull();
  });

  it("**URL のキーを他社のキーに書き換えても、置き場が断る**(署名が合わない)", async () => {
    const id = fileId();
    const signed = await store.presignUpload(A, id, { contentType: "image/jpeg", byteSize: 10 });
    const forged = signed.url.replace(`/incoming/${A}/`, `/incoming/${B}/`);
    expect(forged).not.toBe(signed.url);
    expect((await put(forged, bytes(10), "image/jpeg")).status).toBe(403);
    expect(await store.readIncoming(B, id, 2000)).toBeNull();
  });

  it("大きすぎる物は読まずに tooLarge", async () => {
    const id = fileId();
    const signed = await store.presignUpload(A, id, { contentType: "image/png", byteSize: 100 });
    await put(signed.url, bytes(100), "image/png");
    expect(await store.readIncoming(A, id, 99)).toEqual({ tooLarge: 100 });
  });
});

describe("見る URL", () => {
  it("書き直した物だけを指し、保存の名前と種類が付く。他社のキーに書き換えると断られる", async () => {
    const id = fileId();
    await store.writeFile(A, id, bytes(5, 1), {
      contentType: "image/png",
      contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent("現場.png")}`,
    });
    const signed = await store.presignDownload(A, id);
    const res = await fetch(signed.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes(5, 1));

    const forged = signed.url.replace(`/files/${A}/`, `/files/${B}/`);
    expect((await fetch(forged)).status).toBe(403);
  });

  it("上げただけの物(incoming)は見る URL では取れない", async () => {
    const id = fileId();
    const up = await store.presignUpload(A, id, { contentType: "image/jpeg", byteSize: 3 });
    await put(up.url, bytes(3), "image/jpeg");
    const res = await fetch((await store.presignDownload(A, id)).url);
    expect(res.status).toBe(404);
  });
});

describe("消す", () => {
  async function versionsOf(prefix: string) {
    const page = await admin.send(
      new ListObjectVersionsCommand({ Bucket: BUCKET, Prefix: prefix }),
    );
    return [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])];
  }

  it("1つ消すと今の版が消え、前の版は残る(30日で消えるのはライフサイクル)", async () => {
    const id = fileId();
    await store.writeFile(A, id, bytes(4), {
      contentType: "image/jpeg",
      contentDisposition: "inline",
    });
    await store.remove(A, id);
    const res = await fetch((await store.presignDownload(A, id)).url);
    expect(res.status).toBe(404);
    expect((await versionsOf(objectKey("files", A, id))).length).toBeGreaterThanOrEqual(2);
  });

  it("解約の削除は、その組織の中身を前の版も含めて全部消し、他社の物は残す", async () => {
    const tenant = crypto.randomUUID();
    const other = crypto.randomUUID();
    const id = fileId();
    const meta = { contentType: "image/jpeg" as const, contentDisposition: "inline" };
    await store.writeFile(tenant, id, bytes(1), meta);
    await store.writeFile(tenant, id, bytes(2), meta); // 前の版ができる
    await store.remove(tenant, id); // 消した印ができる
    await admin.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: objectKey("incoming", tenant, id), Body: "x" }),
    );
    await store.writeFile(other, id, bytes(1), meta);

    const counted = await store.purgeTenant(tenant, { dryRun: true });
    expect(counted).toBeGreaterThanOrEqual(4);
    expect(await store.purgeTenant(tenant, { dryRun: false })).toBe(counted);
    expect(await versionsOf(`files/${tenant}/`)).toEqual([]);
    expect(await versionsOf(`incoming/${tenant}/`)).toEqual([]);
    expect((await versionsOf(`files/${other}/`)).length).toBe(1);
  });
});

describe("手元の置き場を作る(docker compose の files-init)", () => {
  it("無ければ作って版を残す設定にし、2回目は何もしない", async () => {
    const files = {
      bucket: "files-local-init",
      region: "us-east-1",
      accessRoleArn: null,
      endpoint,
      publicEndpoint: undefined,
      staticCredentials: KEYS,
    };
    expect(await ensureLocalBucket(files, "http://localhost:8080")).toBe("created");
    expect(await ensureLocalBucket(files, "http://localhost:8080")).toBe("exists");
  });
});
