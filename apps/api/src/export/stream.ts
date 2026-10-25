import { AsyncResource } from "node:async_hooks";
import { EXPORT_FORMAT, type ExportData } from "@app/shared";
import { exportAuditEventsPage } from "../audit/index.ts";
import type { TenantScope } from "../db/scope.ts";
import { exportLegalConsentsPage } from "../domains/legal/index.ts";
import {
  exportEmailChangesPage,
  exportOrganization,
  exportSupportGrantsPage,
  exportUsersPage,
} from "../domains/organizations/index.ts";
import { exportProjectsPage } from "../domains/projects/index.ts";
import { exportTasksPage } from "../domains/tasks/index.ts";
import type { Logger } from "../logger.ts";

// データの書き出しを、1ページずつ読んで流す(docs/specs/0018-export-stream.md・ADR 0031)。
// 形は今までと同じ1つの JSON(format: export@1)。1社の全部をメモリに載せず、ALB の60秒(何も流れない時間)にも当たらない。
//
// - ページごとに短いテナントのトランザクションを開く(inTenant)。RLS が効き、tenant_id でも絞る。
//   受け手が遅くても、トランザクションを開いたまま待たない(idle_in_transaction の10秒・接続プールを握らない)。
// - 受け手が読みに来たときだけ次のページを読む(highWaterMark 0)。関所のトランザクションが閉じる前に
//   2本目の接続を取らない(リクエスト1つで同時に握る接続は1本まで)。
// - 書き出しの途中で変わった行は、入ることも入らないこともある(ページの間に1つの時点をそろえない)。

/** 1ページの行数。1ページの JSON が数百 KB に収まる数(監査ログの書き出しの元の値と同じ) */
export const EXPORT_PAGE_SIZE = 500;

/** テナントの文脈つきの短いトランザクションを開いて fn を呼ぶ(テナントはセッションから。routes.ts) */
export type InTenant = <T>(fn: (s: TenantScope) => Promise<T>) => Promise<T>;

type Section = Exclude<keyof ExportData, "format" | "exportedAt" | "organization">;
type Pager<K extends Section> = (
  s: TenantScope,
  after: never,
  limit: number,
) => Promise<{ rows: ExportData[K]; nextCursor: unknown }>;

/** 並び(JSON の項目の順)。各領域が写す項目を決めて出す(表を丸ごと出さない) */
const SECTIONS: { [K in Section]: Pager<K> } = {
  users: exportUsersPage,
  projects: exportProjectsPage,
  tasks: exportTasksPage,
  auditEvents: exportAuditEventsPage,
  supportGrants: exportSupportGrantsPage,
  emailChanges: exportEmailChangesPage,
  legalConsents: exportLegalConsentsPage,
};

/** JSON の文字列を、項目ごとに少しずつ出す */
export async function* exportChunks(
  inTenant: InTenant,
  exportedAt: string,
  pageSize = EXPORT_PAGE_SIZE,
): AsyncGenerator<string> {
  const organization = await inTenant(exportOrganization);
  yield `{"format":${JSON.stringify(EXPORT_FORMAT)},"exportedAt":${JSON.stringify(exportedAt)},"organization":${JSON.stringify(organization)}`;
  for (const [key, pager] of Object.entries(SECTIONS) as [Section, Pager<Section>][]) {
    yield `,${JSON.stringify(key)}:[`;
    let after: unknown = null;
    let first = true;
    do {
      const page = await inTenant((s) => pager(s, after as never, pageSize));
      if (page.rows.length > 0) {
        yield (first ? "" : ",") + page.rows.map((row) => JSON.stringify(row)).join(",");
        first = false;
      }
      after = page.nextCursor;
    } while (after !== null);
    yield "]";
  }
  yield "}";
}

/**
 * 応答の本文。途中で失敗したら、ログに残して流れを切る(状態コードはもう 200 で返っているので、
 * 本文を最後まで出さずに切る。受け手は壊れた JSON・途中で切れたダウンロードとして気づく)。
 * 失敗の中身は応答に出さない(ログも err だけ。値は packages/logging が落とす)。
 */
export function exportStream(
  chunks: AsyncGenerator<string>,
  logger: Logger,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // 読み手(node-server)の文脈ではなく、リクエストの文脈でログを出す(requestId が入るように)
  const pull = AsyncResource.bind(
    async (controller: ReadableStreamDefaultController<Uint8Array>) => {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (err) {
        logger.error({ err }, "データの書き出しの途中で失敗しました");
        controller.error(err);
      }
    },
  );
  return new ReadableStream<Uint8Array>(
    {
      pull,
      // 受け手が切った(ブラウザを閉じた)。次のページを読まない
      cancel: async () => {
        await chunks.return(undefined);
      },
    },
    { highWaterMark: 0 },
  );
}
