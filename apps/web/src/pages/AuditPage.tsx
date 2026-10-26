import { type AuditEvent, type AuditEventPage, hasFeature, type Me } from "@app/shared";
import { Badge, Heading, Link, Muted, Stack, Table, type TableColumn } from "@app/ui";
import { auditActionLabel, auditActorLabel, auditTargetLabel } from "../audit-labels.ts";
import { formatDateTime } from "../format.ts";
import { AuditExportCard } from "./audit/AuditExportCard.tsx";

// 監査ログ(管理者だけ。docs/specs/0003-audit-log.md)。データは route の loader が読む。
// 続きは URL(?before=…)で進む。共有・再読み込みしても同じページになる。
// プランの機能 audit-export が入った組織だけ、期間を選んで書き出せる(docs/specs/0056-sso-scim-ip-audit-export.md の段3)。
export function AuditPage({ me, page }: { me: Me; page: AuditEventPage }) {
  const columns: TableColumn<AuditEvent>[] = [
    {
      id: "occurredAt",
      header: "日時",
      isRowHeader: true,
      cell: (e) => formatDateTime(e.occurredAt, me.timeZone),
    },
    { id: "actor", header: "誰が", cell: auditActorLabel },
    { id: "action", header: "何を", cell: auditActionLabel },
    { id: "target", header: "対象", cell: auditTargetLabel },
    {
      id: "outcome",
      header: "結果",
      cell: (e) =>
        e.outcome === "allowed" ? (
          <Badge tone="neutral">できた</Badge>
        ) : (
          <Badge tone="danger">拒否</Badge>
        ),
    },
  ];

  return (
    <Stack gap={4}>
      <Heading level={1}>監査ログ</Heading>
      <Muted>
        この組織で、誰が・いつ・何をしたかの記録です(新しい順)。記録は直したり消したりできません。
      </Muted>
      {hasFeature(me, "audit-export") && <AuditExportCard timeZone={me.timeZone} />}
      <Table
        label="監査ログ"
        columns={columns}
        rows={page.events}
        emptyMessage="まだ記録がありません"
      />
      {page.nextCursor && (
        <div>
          <Link href={`/audit?before=${encodeURIComponent(page.nextCursor)}`}>もっと前を見る</Link>
        </div>
      )}
    </Stack>
  );
}
