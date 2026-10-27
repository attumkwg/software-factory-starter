import { AssumeRoleCommand, type STSClient } from "@aws-sdk/client-sts";
import { tenantPrefixes } from "./keys.ts";

// 組織ごとの一時的な権限(docs/security.md の T-4・ADR 0079)。
// 本番・stg は、役割 files-access を STS で引き受け、セッションのポリシーでその組織のキーの頭だけに絞る。
// キーの関数(keys.ts)に誤りがあっても、他社のキーへの署名・読み書きは S3 が断る(層を重ねる)。
// 手元・テスト(RustFS)は固定の資格情報(絞りは効かない。中身は単体テストで、効き目は stg で確かめる)。

/** S3 の SDK に渡す資格情報(SDK の AwsCredentialIdentity と同じ形) */
export type AwsCredentialIdentity = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
};

export type TenantCredentials = {
  /** その組織だけに絞った資格情報。待つことがあるので、関所のトランザクションの外で呼ぶ */
  forTenant(tenantId: string): Promise<AwsCredentialIdentity>;
};

/** その組織のキーの頭だけを許すセッションのポリシー(役割の権限との重なりだけが効く) */
export function tenantSessionPolicy(bucket: string, tenantId: string): string {
  const prefixes = tenantPrefixes(tenantId);
  const bucketArn = `arn:aws:s3:::${bucket}`;
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "TenantObjects",
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:GetObjectVersion",
          "s3:DeleteObjectVersion",
        ],
        Resource: prefixes.map((p) => `${bucketArn}/${p}*`),
      },
      {
        Sid: "TenantList",
        Effect: "Allow",
        Action: ["s3:ListBucket", "s3:ListBucketVersions"],
        Resource: bucketArn,
        Condition: { StringLike: { "s3:prefix": prefixes.map((p) => `${p}*`) } },
      },
    ],
  });
}

/** 期限のこれだけ前に取り直す(署名つき URL の期限 5分より長く) */
const REFRESH_BEFORE_MS = 10 * 60 * 1000;
/** STS の権限の長さ(役割の連鎖は最長1時間) */
const DURATION_SECONDS = 3600;

/** STS で組織ごとに取り、期限の10分前まで覚えておく(同じ組織の同時の呼び出しは1回にまとめる) */
export function stsTenantCredentials(opts: {
  sts: Pick<STSClient, "send">;
  roleArn: string;
  bucket: string;
  now?: () => number;
}): TenantCredentials {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, Promise<AwsCredentialIdentity>>();

  async function assume(tenantId: string): Promise<AwsCredentialIdentity> {
    const res = await opts.sts.send(
      new AssumeRoleCommand({
        RoleArn: opts.roleArn,
        // CloudTrail で組織ごとに追える(組織の ID は個人情報ではない)
        RoleSessionName: `files-${tenantId}`,
        Policy: tenantSessionPolicy(opts.bucket, tenantId),
        DurationSeconds: DURATION_SECONDS,
      }),
    );
    const c = res.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
      throw new Error("STS が資格情報を返しませんでした");
    }
    return {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
      expiration: c.Expiration,
    };
  }

  return {
    async forTenant(tenantId) {
      const cached = cache.get(tenantId);
      if (cached) {
        const creds = await cached.catch(() => null);
        const exp = creds?.expiration?.getTime() ?? 0;
        if (creds && exp - now() > REFRESH_BEFORE_MS) return creds;
        if (cache.get(tenantId) === cached) cache.delete(tenantId);
      }
      const pending = assume(tenantId);
      cache.set(tenantId, pending);
      pending.catch(() => {
        if (cache.get(tenantId) === pending) cache.delete(tenantId);
      });
      return pending;
    },
  };
}

/** 手元・テスト(RustFS)の固定の資格情報。組織ごとに絞らない */
export function staticTenantCredentials(creds: AwsCredentialIdentity): TenantCredentials {
  return { forTenant: async () => creds };
}
