import type { Me, OrganizationMember } from "@app/shared";
import { Button, ConfirmDialog, Heading, Muted, Stack, Table, type TableColumn } from "@app/ui";
import { api } from "../api.ts";
import { formatDateTime } from "../format.ts";
import { roleLabel } from "../permissions.ts";
import { useAction } from "../use-action.ts";

// 組織の人と強制ログアウト(組織の管理者。docs/specs/0056-sso-scim-ip-audit-export.md)。
// 切ると、その人のこの組織の全部の端末が、次の操作からログインし直しになる(端末をなくした・退職の当日など)。
export function MembersPage({ me, members }: { me: Me; members: OrganizationMember[] }) {
  const signingOut = useAction();

  const columns: TableColumn<OrganizationMember>[] = [
    { id: "name", header: "名前", isRowHeader: true, cell: (m) => m.name },
    { id: "email", header: "メールアドレス", cell: (m) => m.email },
    { id: "role", header: "ロール", cell: (m) => roleLabel(m.role) },
    { id: "createdAt", header: "参加", cell: (m) => formatDateTime(m.createdAt, me.timeZone) },
    {
      id: "actions",
      header: "操作",
      cell: (m) =>
        m.id === me.userId ? (
          "—"
        ) : (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="secondary">
                強制ログアウト
              </Button>
            }
            title="この人をログアウトさせますか?"
            confirmLabel="ログアウトさせる"
            isDestructive
            onConfirm={async () => {
              await signingOut.run(() => api.signOutMember(m.id), {
                success: "ログアウトさせました",
              });
            }}
          >
            {m.name} さんの、この組織の全部の端末が、次の操作からログインし直しになります。
            パスワードは変わりません(必要なら本人に変えてもらってください)。
          </ConfirmDialog>
        ),
    },
  ];

  return (
    <Stack gap={4}>
      <Heading level={1}>組織の人</Heading>
      <Muted>
        端末をなくした人・辞める人がいたら、ここからログアウトさせられます。したことは監査ログに残ります。
      </Muted>
      <Table label="組織の人" columns={columns} rows={members} emptyMessage="まだ誰もいません" />
    </Stack>
  );
}
