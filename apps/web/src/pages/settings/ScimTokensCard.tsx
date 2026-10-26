import { SCIM_TOKENS_MAX, type ScimToken, type ScimTokenList } from "@app/shared";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Heading,
  Muted,
  Stack,
  Table,
  type TableColumn,
} from "@app/ui";
import { useState } from "react";
import { api } from "../../api.ts";
import { formatDateTime } from "../../format.ts";
import { useAction } from "../../use-action.ts";

// SCIM の鍵(管理者だけ。プランの機能 scim。docs/specs/0056-sso-scim-ip-audit-export.md の段2)。
// 情シスの道具(Entra ID・Okta など)にこの入口と鍵を渡すと、道具から人を作る・止めることができる。
// 鍵は作ったときにこの画面に1回だけ出る(保存していない)。生きている鍵は2つまで(入れ替えのとき)。

export function ScimTokensCard({ state, timeZone }: { state: ScimTokenList; timeZone: string }) {
  const creating = useAction();
  const revoking = useAction();
  const [token, setToken] = useState<string | null>(null);
  const endpoint =
    typeof window === "undefined" ? state.basePath : `${window.location.origin}${state.basePath}`;

  const columns: TableColumn<ScimToken>[] = [
    {
      id: "createdAt",
      header: "作った",
      isRowHeader: true,
      cell: (t) => formatDateTime(t.createdAt, timeZone),
    },
    {
      id: "lastUsedAt",
      header: "最後に使われた",
      cell: (t) => (t.lastUsedAt ? formatDateTime(t.lastUsedAt, timeZone) : "まだ"),
    },
    {
      id: "actions",
      header: "操作",
      cell: (t) => (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="secondary">
              取り消す
            </Button>
          }
          title="この鍵を取り消しますか?"
          confirmLabel="取り消す"
          isDestructive
          onConfirm={async () => {
            await revoking.run(() => api.revokeScimToken(t.id), { success: "取り消しました" });
          }}
        >
          この鍵を使っている情シスの道具は、次の連携から失敗します。取り消した鍵は戻せません。
        </ConfirmDialog>
      ),
    },
  ];

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>SCIM(情シスの道具との連携)</Heading>
        <Muted>
          情シスの道具に、入口 <code>{endpoint}</code>{" "}
          と鍵を渡すと、会社のドメインの人を道具から作る・止めることができます(止めた人はすぐに入れなくなります)。ロールは画面で決めてください。
        </Muted>
        <div>
          <Button
            variant="primary"
            isDisabled={creating.pending || state.tokens.length >= SCIM_TOKENS_MAX}
            onPress={async () => {
              await creating.run(
                async () => {
                  setToken((await api.createScimToken()).token);
                },
                { success: "鍵を作りました" },
              );
            }}
          >
            鍵を作る
          </Button>
        </div>
        {token && (
          <Alert tone="info">
            この鍵を情シスの道具に貼ってください: <code data-testid="scim-token">{token}</code>
            <br />
            鍵はこの画面にだけ出ます(保存していないので、閉じると二度と出ません)。
          </Alert>
        )}
        <Table
          label="SCIM の鍵"
          columns={columns}
          rows={state.tokens}
          emptyMessage="まだ鍵がありません"
        />
      </Stack>
    </Card>
  );
}
