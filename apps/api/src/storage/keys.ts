// 置き場(S3)のキーを作る所。**キーはここの関数でだけ作る**(docs/designs/0072-file-storage.md の 1・ADR 0079)。
//
//   <段>/<組織の ID>/<ファイルの ID>
//
// 段を一番上にするのは、ライフサイクル(上げ終えない物を1日で消す)がキーの頭でしか分けられないため。
// 組織の ID はいつも2番目で、権限の絞り(tenant-credentials.ts)と解約の削除も同じ形で書く。
// 組織の ID はセッションから(T-1)。利用者の値(名前)はキーに入れない(推測・個人情報)。

export const OBJECT_STAGES = ["incoming", "files"] as const;
export type ObjectStage = (typeof OBJECT_STAGES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertId(kind: string, id: string): void {
  if (!UUID.test(id)) throw new Error(`置き場のキーに使えない ${kind} の形です`);
}

/** 1つのファイルのキー。ID が UUID の形でなければ投げる(区切り・.. を混ぜられない) */
export function objectKey(stage: ObjectStage, tenantId: string, fileId: string): string {
  assertId("組織の ID", tenantId);
  assertId("ファイルの ID", fileId);
  return `${stage}/${tenantId}/${fileId}`;
}

/** 1つの組織の置き場の頭(最後は /)。権限の絞りと解約の削除が使う */
export function tenantPrefixes(tenantId: string): string[] {
  assertId("組織の ID", tenantId);
  return OBJECT_STAGES.map((stage) => `${stage}/${tenantId}/`);
}
