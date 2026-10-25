import { IP_ALLOWLIST_MAX, type IpAllowlist } from "@app/shared";
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
  TextField,
} from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { useAction } from "../../use-action.ts";

// 組織に入れる IP の範囲(管理者だけ。プランの機能 ip-allowlist。docs/specs/0056-sso-scim-ip-audit-export.md)。
// 1つでも決めると、範囲の外からはログインも操作もできない(すぐ効く)。いまの IP を外す一覧は保存できない(409)。

export function IpAllowlistCard({ state }: { state: IpAllowlist }) {
  const [cidr, setCidr] = useState("");
  const adding = useAction();
  const removing = useAction();

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const ok = await adding.run(() => api.putIpAllowlist([...state.cidrs, cidr.trim()]), {
      success: "足しました",
      showErrorAs: "inline",
    });
    if (ok) setCidr("");
  }

  const columns: TableColumn<{ id: string }>[] = [
    { id: "cidr", header: "IP の範囲", isRowHeader: true, cell: (r) => r.id },
    {
      id: "actions",
      header: "操作",
      cell: (r) => (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="secondary">
              外す
            </Button>
          }
          title="この範囲を外しますか?"
          confirmLabel="外す"
          isDestructive
          onConfirm={async () => {
            await removing.run(() => api.putIpAllowlist(state.cidrs.filter((c) => c !== r.id)), {
              success: "外しました",
            });
          }}
        >
          {r.id} からは、すぐに入れなくなります。全部外すと、どこからでも入れるようになります。
        </ConfirmDialog>
      ),
    },
  ];

  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2} align="center">
          <Heading level={2}>IP の制限</Heading>
          <Badge tone={state.cidrs.length > 0 ? "success" : "neutral"}>
            {state.cidrs.length > 0 ? "制限あり" : "制限なし"}
          </Badge>
        </Inline>
        <Muted>
          会社のネットワークの範囲(203.0.113.0/24 の形。{IP_ALLOWLIST_MAX}{" "}
          個まで)を決めると、その外からはログインも操作もできなくなります。いまの IP:{" "}
          {state.yourIp ?? "分かりません"}
        </Muted>
        <form onSubmit={onAdd}>
          <Inline gap={2}>
            <TextField
              label="IP の範囲"
              placeholder="203.0.113.0/24"
              isRequired
              value={cidr}
              onChange={setCidr}
              isInvalid={adding.errorMessage !== undefined}
              errorMessage={adding.errorMessage}
            />
            <div>
              <Button type="submit" variant="primary" isDisabled={adding.pending}>
                足す
              </Button>
            </div>
          </Inline>
        </form>
        <Table
          label="IP の範囲"
          columns={columns}
          rows={state.cidrs.map((id) => ({ id }))}
          emptyMessage="決めていません(どこからでも入れます)"
        />
      </Stack>
    </Card>
  );
}
