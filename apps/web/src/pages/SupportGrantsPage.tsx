import { type Me, SUPPORT_GRANT_HOURS, type SupportGrant } from "@app/shared";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Heading,
  Inline,
  Muted,
  Select,
  Stack,
  Table,
  type TableColumn,
} from "@app/ui";
import { useState } from "react";
import { api } from "../api.ts";
import { formatDateTime } from "../format.ts";
import { useAction } from "../use-action.ts";

// サポートへの許可(組織の管理者。docs/specs/0004-support-access.md)。
// 許可すると番号が1回だけ出る(保存しないので、閉じたら二度と出ない)。
const HOUR_LABELS: Record<(typeof SUPPORT_GRANT_HOURS)[number], string> = {
  1: "1時間",
  24: "24時間",
  72: "3日",
};
const STATUS: Record<SupportGrant["status"], { label: string; tone: "success" | "neutral" }> = {
  active: { label: "有効", tone: "success" },
  expired: { label: "期限切れ", tone: "neutral" },
  revoked: { label: "取り消し済み", tone: "neutral" },
};

export function SupportGrantsPage({ me, grants }: { me: Me; grants: SupportGrant[] }) {
  const [hours, setHours] = useState<string>("24");
  const [code, setCode] = useState<string | null>(null);
  const granting = useAction();
  const revoking = useAction();

  const columns: TableColumn<SupportGrant>[] = [
    {
      id: "createdAt",
      header: "許可した日時",
      isRowHeader: true,
      cell: (g) => formatDateTime(g.createdAt, me.timeZone),
    },
    { id: "expiresAt", header: "期限", cell: (g) => formatDateTime(g.expiresAt, me.timeZone) },
    {
      id: "status",
      header: "状態",
      cell: (g) => <Badge tone={STATUS[g.status].tone}>{STATUS[g.status].label}</Badge>,
    },
    {
      id: "actions",
      header: "操作",
      cell: (g) =>
        g.status === "active" ? (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="secondary">
                取り消す
              </Button>
            }
            title="サポートへの許可を取り消しますか?"
            confirmLabel="取り消す"
            isDestructive
            onConfirm={async () => {
              await revoking.run(() => api.revokeSupportGrant(g.id), {
                success: "取り消しました",
              });
            }}
          >
            サポートは、この許可ではもう入れません。いま見ている社員も、すぐに見られなくなります。
          </ConfirmDialog>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <Stack gap={4}>
      <Heading level={1}>サポートへの許可</Heading>
      <Muted>
        問い合わせのときに、サポートの社員がこの組織の画面を「見るだけ」で確かめられるようにします。
        社員が入った・見た・出たは、すべて監査ログに残ります。いつでも取り消せます。
      </Muted>
      <Inline gap={2}>
        <Select
          label="許可する長さ"
          options={SUPPORT_GRANT_HOURS.map((h) => ({ id: String(h), label: HOUR_LABELS[h] }))}
          value={hours}
          onChange={setHours}
        />
        <Button
          variant="primary"
          isDisabled={granting.pending}
          onPress={async () => {
            await granting.run(
              async () => {
                const g = await api.createSupportGrant({
                  hours: Number(hours) as (typeof SUPPORT_GRANT_HOURS)[number],
                });
                setCode(g.code);
              },
              { success: "許可しました" },
            );
          }}
        >
          許可する
        </Button>
      </Inline>
      {code && (
        <Alert tone="info">
          この番号をサポートに伝えてください: <strong data-testid="support-code">{code}</strong>
          <br />
          番号はこの画面にだけ出ます(保存していないので、閉じると二度と出ません)。
        </Alert>
      )}
      <Table
        label="サポートへの許可"
        columns={columns}
        rows={grants}
        emptyMessage="まだ許可していません"
      />
    </Stack>
  );
}
