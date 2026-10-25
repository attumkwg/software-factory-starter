import {
  INVITATION_DAYS,
  type Invitation,
  type Me,
  type OrganizationPlan,
  ROLES,
  type Role,
} from "@app/shared";
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
  TextField,
} from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";
import { formatDateTime } from "../format.ts";
import { roleLabel } from "../permissions.ts";
import { useAction } from "../use-action.ts";

// 招待(組織の管理者。docs/specs/0027-invitations.md)。メールとロールで招くと、招待のメールが届く。
// リンクは期限つき・1回きり。受けていない招待は取り消せる(リンクはすぐ使えなくなる)。
const STATUS: Record<
  Invitation["status"],
  { label: string; tone: "success" | "info" | "neutral" }
> = {
  pending: { label: "受けていない", tone: "info" },
  accepted: { label: "参加した", tone: "success" },
  expired: { label: "期限切れ", tone: "neutral" },
  revoked: { label: "取り消し済み", tone: "neutral" },
};

export function InvitationsPage({
  me,
  invitations,
  plan,
}: {
  me: Me;
  invitations: Invitation[];
  plan: OrganizationPlan;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const inviting = useAction();
  const revoking = useAction();

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    const ok = await inviting.run(() => api.createInvitation({ email, role: role as Role }), {
      success: "招待のメールを送りました",
      showErrorAs: "inline",
    });
    if (ok) setEmail("");
  }

  const columns: TableColumn<Invitation>[] = [
    { id: "email", header: "メールアドレス", isRowHeader: true, cell: (i) => i.email },
    { id: "role", header: "ロール", cell: (i) => roleLabel(i.role) },
    {
      id: "status",
      header: "状態",
      cell: (i) => <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>,
    },
    { id: "expiresAt", header: "期限", cell: (i) => formatDateTime(i.expiresAt, me.timeZone) },
    {
      id: "actions",
      header: "操作",
      cell: (i) =>
        i.status === "pending" ? (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="secondary">
                取り消す
              </Button>
            }
            title="招待を取り消しますか?"
            confirmLabel="取り消す"
            isDestructive
            onConfirm={async () => {
              await revoking.run(() => api.revokeInvitation(i.id), { success: "取り消しました" });
            }}
          >
            {i.email} に送ったリンクは、すぐに使えなくなります。
          </ConfirmDialog>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <Stack gap={4}>
      <Heading level={1}>招待</Heading>
      <Muted>
        メールアドレスとロールを選んで招くと、招待のメールが届きます。リンクは{INVITATION_DAYS}
        日間・1回だけ使えます。招かれた人は、そのメールアドレスで登録してログインすると、この組織に入ります。
      </Muted>
      <SeatLine plan={plan} />
      <form onSubmit={onInvite}>
        <Stack gap={2}>
          <Inline gap={2}>
            <TextField
              label="招く人のメールアドレス"
              type="email"
              isRequired
              value={email}
              onChange={setEmail}
              isInvalid={inviting.errorMessage !== undefined}
              errorMessage={inviting.errorMessage}
            />
            <Select
              label="ロール"
              options={ROLES.map((r) => ({ id: r, label: roleLabel(r) }))}
              value={role}
              onChange={setRole}
            />
          </Inline>
          <div>
            <Button type="submit" variant="primary" isDisabled={inviting.pending}>
              招く
            </Button>
          </div>
        </Stack>
      </form>
      <Table
        label="招待"
        columns={columns}
        rows={invitations}
        emptyMessage="まだ誰も招いていません"
      />
    </Stack>
  );
}

/** プランと人数(docs/specs/0047-plans.md)。人数は「いる人+受けていない招待」で数える。超えても招ける(運営から連絡する) */
function SeatLine({ plan }: { plan: OrganizationPlan }) {
  const used = plan.members + plan.pendingInvitations;
  if (!plan.plan) return <Muted>いまの人数: {used} 人(受けていない招待を含む)</Muted>;
  const limit = plan.plan.seats === null ? "人数の上限なし" : `契約の人数 ${plan.plan.seats} 人`;
  return (
    <Muted>
      プラン「{plan.plan.label}」: {limit}・いまの人数 {used} 人(受けていない招待を含む)
    </Muted>
  );
}
