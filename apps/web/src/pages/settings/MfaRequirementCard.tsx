import type { Me, MfaRequirement } from "@app/shared";
import { Badge, Button, Card, ConfirmDialog, Heading, Inline, Link, Muted, Stack } from "@app/ui";
import { api } from "../../api.ts";
import { useAction } from "../../use-action.ts";

// 組織の二段階認証の必須(管理者だけ。docs/specs/0006-account-security.md)。
// 入れるとすぐ効き、まだ設定していない人は次の操作から設定の画面へ回される。入れられるのは自分が設定済みの管理者だけ。

export function MfaRequirementCard({ me, state }: { me: Me; state: MfaRequirement }) {
  const action = useAction();
  const selfReady = me.mfa?.enabled === true;
  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2} align="center">
          <Heading level={2}>二段階認証</Heading>
          <Badge tone={state.required ? "success" : "neutral"}>
            {state.required ? "全員に必須" : "任意"}
          </Badge>
        </Inline>
        <Muted>
          必須にすると、この組織の全員が、ログインのときに認証アプリのコードを求められます。まだ設定していない人:{" "}
          {state.usersWithoutMfa} 人
        </Muted>
        {state.required ? (
          <div>
            <Button
              variant="secondary"
              isDisabled={action.pending}
              onPress={() => action.run(() => api.unrequireMfa(), { success: "必須を切りました" })}
            >
              必須を切る
            </Button>
          </div>
        ) : selfReady ? (
          <div>
            <ConfirmDialog
              trigger={<Button variant="primary">全員に必須にする</Button>}
              title="二段階認証を全員に必須にしますか"
              confirmLabel="必須にする"
              onConfirm={async () => {
                await action.run(() => api.requireMfa(), { success: "全員に必須にしました" });
              }}
            >
              まだ設定していない {state.usersWithoutMfa}{" "}
              人は、次の操作から二段階認証の設定の画面へ回されます。設定するまで、ほかの画面は使えません。
            </ConfirmDialog>
          </div>
        ) : (
          <Muted>
            必須にする前に、まず自分の二段階認証を設定してください(
            <Link href="/account">アカウント</Link>)。
          </Muted>
        )}
      </Stack>
    </Card>
  );
}
