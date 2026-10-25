import { readFile } from "node:fs/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// 申し込みの JSON を読む所(docs/specs/0026-tenant-provisioning.md・docs/designs/0026-tenant-provisioning.md の 5)。
// 本番・stg は非公開の S3(申し込みの置き場。Terraform が移行のタスクに APPLICATIONS_BUCKET を入れる)から、
// キーだけを引数で受けて読む。引数は CloudTrail の RunTask の記録に残るので、名前・メールを引数に渡さない。
// 使い捨ての環境(local / test / preview)で置き場が無ければ、引数を手元のファイルの道すじとして読む。

/** 置き場のキーの形。会社や人の名前を入れられないように、英数字・-・_ だけ(申込番号か日付+番号) */
export const APPLICATION_KEY = /^applications\/[A-Za-z0-9_-]{1,100}\.json$/;

export type ApplicationSource = { read(key: string): Promise<string> };

/** S3 から読む。キーの形が違えば読まずに止める。読めなければ、キーだけを言って止める(中身は出さない) */
export function s3ApplicationSource(
  bucket: string,
  client: Pick<S3Client, "send"> = new S3Client({}),
): ApplicationSource {
  return {
    async read(key) {
      if (!APPLICATION_KEY.test(key)) {
        throw new Error(
          "置き場のキーの形が違います(applications/<英数字・-・_>.json。会社や人の名前は入れない)",
        );
      }
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = await res.Body?.transformToString("utf8");
        if (body === undefined) throw new Error("empty body");
        return body;
      } catch (e) {
        const name = (e as { name?: string }).name ?? "Error";
        throw new Error(`申し込みの置き場から読めません: ${key}(${name})`);
      }
    },
  };
}

/** 手元のファイルを読む(使い捨ての環境だけ) */
export const fileApplicationSource: ApplicationSource = {
  read: (path) => readFile(path, "utf8"),
};

/** 環境に合わせて選ぶ。本番・stg で置き場が無ければ止める(手元のファイルは読まない) */
export function applicationSourceFor(env: {
  appEnv: string;
  bucket: string | undefined;
}): ApplicationSource {
  if (env.bucket) return s3ApplicationSource(env.bucket);
  if (env.appEnv === "local" || env.appEnv === "test" || env.appEnv === "preview") {
    return fileApplicationSource;
  }
  throw new Error(
    `${env.appEnv} に申し込みの置き場(APPLICATIONS_BUCKET)がありません(Terraform の module.applications)`,
  );
}
