import type { OrganizationDomain } from "@app/shared";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Heading,
  Inline,
  Muted,
  Stack,
  Table,
  type TableColumn,
  Text,
  TextField,
} from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { useAction } from "../../use-action.ts";

// 会社のドメイン(管理者だけ。プランの機能 sso。docs/specs/0056-sso-scim-ip-audit-export.md)。
// DNS に TXT を置いて確かめたドメインだけが、SSO で「この組織の人」を決めるのに使われる(SSO をつなぐのは運営)。

export function DomainsCard({ domains }: { domains: OrganizationDomain[] }) {
  const [domain, setDomain] = useState("");
  const adding = useAction();
  const action = useAction();

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const ok = await adding.run(() => api.createDomain(domain.trim().toLowerCase()), {
      success: "登録しました。DNS に TXT を置いてから「確かめる」を押してください",
      showErrorAs: "inline",
    });
    if (ok) setDomain("");
  }

  const columns: TableColumn<OrganizationDomain>[] = [
    { id: "domain", header: "ドメイン", isRowHeader: true, cell: (d) => d.domain },
    {
      id: "status",
      header: "状態",
      cell: (d) =>
        d.verifiedAt ? <Badge tone="success">確かめた</Badge> : <Badge tone="info">未確認</Badge>,
    },
    {
      id: "record",
      header: "DNS に置く TXT",
      cell: (d) =>
        d.verifiedAt ? (
          "—"
        ) : (
          <Stack gap={1}>
            <Text>名前: {d.verifyRecord.name}</Text>
            <Text>値: {d.verifyRecord.value}</Text>
          </Stack>
        ),
    },
    {
      id: "actions",
      header: "操作",
      cell: (d) => (
        <Inline gap={2}>
          {!d.verifiedAt && (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={action.pending}
              onPress={() => action.run(() => api.verifyDomain(d.id), { success: "確かめました" })}
            >
              確かめる
            </Button>
          )}
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="secondary">
                消す
              </Button>
            }
            title="ドメインを消しますか?"
            confirmLabel="消す"
            isDestructive
            onConfirm={async () => {
              await action.run(() => api.deleteDomain(d.id), { success: "消しました" });
            }}
          >
            {d.domain} を消すと、SSO でこのドメインの人をこの組織に入れなくなります。
          </ConfirmDialog>
        </Inline>
      ),
    },
  ];

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>会社のドメイン</Heading>
        <Muted>
          会社のメールのドメインを登録し、DNS に確かめの TXT
          を置いてください。確かめたドメインは、ほかの組織では使えません。
        </Muted>
        <form onSubmit={onAdd}>
          <Inline gap={2}>
            <TextField
              label="ドメイン"
              placeholder="example.co.jp"
              isRequired
              value={domain}
              onChange={setDomain}
              isInvalid={adding.errorMessage !== undefined}
              errorMessage={adding.errorMessage}
            />
            <div>
              <Button type="submit" variant="primary" isDisabled={adding.pending}>
                登録する
              </Button>
            </div>
          </Inline>
        </form>
        <Table
          label="会社のドメイン"
          columns={columns}
          rows={domains}
          emptyMessage="まだ登録していません"
        />
      </Stack>
    </Card>
  );
}
