import { type Me, type OrganizationMember, ROLES, type Role } from "@app/shared";
import {
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
import { roleLabel } from "../permissions.ts";
import { useAction } from "../use-action.ts";

// 組織の人(組織の管理者。docs/specs/0079-member-admin.md・0056-sso-scim-ip-audit-export.md)。
// 辞めた人は「止める」(行・作った物・記録は残り、ログインできず、契約の人数にも数えない。戻せる)。
// 強制ログアウトは、その人のこの組織の全部の端末を、次の操作からログインし直しにする(端末をなくしたときなど)。
// 自分は変えられない(ほかの管理者に頼む)。守りは API 側(有効な管理者を0人にできない)。
export function MembersPage({ me, members }: { me: Me; members: OrganizationMember[] }) {
  const action = useAction();

  const columns: TableColumn<OrganizationMember>[] = [
    { id: "name", header: "名前", isRowHeader: true, cell: (m) => m.name },
    { id: "email", header: "メールアドレス", cell: (m) => m.email },
    { id: "role", header: "ロール", cell: (m) => roleLabel(m.role) },
    {
      id: "status",
      header: "状態",
      cell: (m) => (
        <Stack gap={1}>
          {m.disabledAt ? <Badge tone="warning">止めた</Badge> : <Badge>使える</Badge>}
          {m.scimManaged ? <Muted>情シスの道具で管理</Muted> : null}
        </Stack>
      ),
    },
    { id: "createdAt", header: "参加", cell: (m) => formatDateTime(m.createdAt, me.timeZone) },
    {
      id: "actions",
      header: "操作",
      cell: (m) =>
        m.id === me.userId ? (
          "—"
        ) : (
          <Inline gap={2}>
            <RoleDialog
              member={m}
              onChange={(role) =>
                action.run(() => api.changeMemberRole(m.id, role), {
                  success: `${m.name} さんを${roleLabel(role)}にしました`,
                })
              }
            />
            {m.disabledAt ? (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="secondary">
                    戻す
                  </Button>
                }
                title="この人を戻しますか?"
                confirmLabel="戻す"
                onConfirm={async () => {
                  await action.run(() => api.enableMember(m.id), { success: "戻しました" });
                }}
              >
                {m.name} さんが、前のロール({roleLabel(m.role)})でまた入れるようになり、
                契約の人数にも数えます。
              </ConfirmDialog>
            ) : (
              <>
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="secondary">
                      止める
                    </Button>
                  }
                  title="この人を止めますか?"
                  confirmLabel="止める"
                  isDestructive
                  onConfirm={async () => {
                    await action.run(() => api.disableMember(m.id), { success: "止めました" });
                  }}
                >
                  {m.name}{" "}
                  さんは、この組織にログインできなくなり、いま開いている端末も次の操作で外れます。
                  契約の人数にも数えません。作ったプロジェクト・タスク・写真と記録は残り、あとで戻せます。
                  {m.scimManaged
                    ? " この人は情シスの道具で管理しています。道具の側でも止めないと、次の同期で戻ります。"
                    : ""}
                </ConfirmDialog>
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
                    await action.run(() => api.signOutMember(m.id), {
                      success: "ログアウトさせました",
                    });
                  }}
                >
                  {m.name} さんの、この組織の全部の端末が、次の操作からログインし直しになります。
                  パスワードは変わりません(必要なら本人に変えてもらってください)。
                </ConfirmDialog>
              </>
            )}
          </Inline>
        ),
    },
  ];

  return (
    <Stack gap={4}>
      <Heading level={1}>組織の人</Heading>
      <Muted>
        辞めた人は「止める」と、ログインできなくなり、契約の人数からも外れます(作った物と記録は残り、戻せます)。
        端末をなくした人は「強制ログアウト」。したことは監査ログに残ります。自分のロールは、ほかの管理者に変えてもらってください。
      </Muted>
      <Table label="組織の人" columns={columns} rows={members} emptyMessage="まだ誰もいません" />
    </Stack>
  );
}

/** ロールを選んで変える(選び直すまで何も送らない) */
function RoleDialog({
  member,
  onChange,
}: {
  member: OrganizationMember;
  onChange: (role: Role) => Promise<unknown>;
}) {
  const [role, setRole] = useState<Role>(member.role);
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="secondary">
          ロールを変える
        </Button>
      }
      title={`${member.name} さんのロール`}
      confirmLabel="変える"
      onConfirm={async () => {
        if (role !== member.role) await onChange(role);
      }}
    >
      <Stack gap={2}>
        <Select
          label="ロール"
          options={ROLES.map((r) => ({ id: r, label: roleLabel(r) }))}
          value={role}
          onChange={(v) => setRole(v as Role)}
        />
        <Muted>次の操作から効きます。管理者から外すと、SSO の緊急用からも外れます。</Muted>
      </Stack>
    </ConfirmDialog>
  );
}
