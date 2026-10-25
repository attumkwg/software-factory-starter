import type { OrganizationMembership } from "@app/shared";
import { Badge, Button, Heading, Muted, Stack, Table, type TableColumn } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { api } from "../api.ts";
import { roleLabel } from "../permissions.ts";
import { useAction } from "../use-action.ts";

// 所属している組織の一覧と、選び直し(docs/specs/0055-multi-org-membership.md)。
// 選び直したら、前の組織のデータを画面の覚え(キャッシュ)に残さない(全部捨ててから一覧へ)。
export function OrganizationsPage({ organizations }: { organizations: OrganizationMembership[] }) {
  const router = useRouter();
  const switching = useAction();

  type Row = OrganizationMembership & { id: string };
  const rows: Row[] = organizations.map((o) => ({ ...o, id: o.tenantId }));
  const columns: TableColumn<Row>[] = [
    { id: "name", header: "組織", isRowHeader: true, cell: (o) => o.name },
    { id: "role", header: "ロール", cell: (o) => roleLabel(o.role) },
    {
      id: "actions",
      header: "操作",
      cell: (o) =>
        o.current ? (
          <Badge tone="info">いまの組織</Badge>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            isDisabled={switching.pending}
            onPress={async () => {
              const done = await switching.run(() => api.switchOrganization(o.tenantId));
              if (!done) return;
              router.clearCache();
              await router.navigate({ to: "/" });
            }}
          >
            切り替える
          </Button>
        ),
    },
  ];

  return (
    <Stack gap={4}>
      <Heading level={1}>組織を切り替える</Heading>
      <Muted>
        所属している組織です。切り替えると、その組織の画面になります(見えるのは、いまの組織のデータだけです)。
      </Muted>
      <Table label="所属している組織" columns={columns} rows={rows} />
    </Stack>
  );
}
