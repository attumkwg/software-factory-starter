import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "../config.ts";

// 手元(docker compose)の S3 互換の置き場(RustFS)に、置き場を作る(docs/guides/local-environment.md)。
// 本番・stg の置き場は Terraform(modules/file-storage)が作るので、ここは手元の入口(FILES_S3_ENDPOINT)があるときだけ。
// 何度流しても同じ(ある置き場はそのまま)。版を残す・画面の出どころから PUT と GET を許す。

export async function ensureLocalBucket(
  files: NonNullable<Config["files"]>,
  appOrigin: string,
): Promise<"created" | "exists"> {
  if (!files.endpoint || !files.staticCredentials) {
    throw new Error("手元の置き場の入口(FILES_S3_ENDPOINT と固定の鍵)が無いので作りません");
  }
  const client = new S3Client({
    region: files.region,
    endpoint: files.endpoint,
    forcePathStyle: true,
    credentials: files.staticCredentials,
  });
  try {
    const result = await create(client, files.bucket);
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: files.bucket,
        VersioningConfiguration: { Status: "Enabled" },
      }),
    );
    await client.send(
      new PutBucketCorsCommand({
        Bucket: files.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedMethods: ["PUT", "GET"],
              AllowedOrigins: [appOrigin],
              AllowedHeaders: ["content-type"],
              MaxAgeSeconds: 600,
            },
          ],
        },
      }),
    );
    return result;
  } finally {
    client.destroy();
  }
}

/** 有るかを先に見る(us-east-1 では、自分の置き場を作り直しても成功が返るので、作れたかでは分からない) */
async function create(client: S3Client, bucket: string): Promise<"created" | "exists"> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return "exists";
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw e;
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  return "created";
}
