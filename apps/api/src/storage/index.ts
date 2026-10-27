import { STSClient } from "@aws-sdk/client-sts";
import type { Config } from "../config.ts";
import { type ObjectStore, s3ObjectStore } from "./object-store.ts";
import { staticTenantCredentials, stsTenantCredentials } from "./tenant-credentials.ts";

// 写真・ファイルの置き場(docs/designs/0072-file-storage.md)。ほかからはここだけを使う。
export { objectKey, tenantPrefixes } from "./keys.ts";
export { ensureLocalBucket } from "./local-bucket.ts";
export type { ObjectStore, SignedUrl } from "./object-store.ts";
export { BrokenFileError, detectContentType, stripMetadata } from "./strip-metadata.ts";

/** 設定から置き場を作る。置き場が設定されていなければ null(ファイルの API は 503) */
export function objectStoreFromConfig(files: Config["files"]): ObjectStore | null {
  if (!files) return null;
  const credentials = files.accessRoleArn
    ? stsTenantCredentials({
        sts: new STSClient({ region: files.region }),
        roleArn: files.accessRoleArn,
        bucket: files.bucket,
      })
    : staticTenantCredentials(files.staticCredentials ?? noCredentials());
  return s3ObjectStore({
    bucket: files.bucket,
    region: files.region,
    credentials,
    endpoint: files.endpoint,
    publicEndpoint: files.publicEndpoint,
  });
}

function noCredentials(): never {
  throw new Error(
    "置き場の資格情報がありません(FILES_ACCESS_ROLE_ARN か、手元の FILES_S3_ACCESS_KEY)",
  );
}
