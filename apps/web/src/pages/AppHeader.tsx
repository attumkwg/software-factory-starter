import type { AuthOptions, Me } from "@app/shared";
import { Alert, Badge, Button, Inline, Link, Page, Stack } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import { formatDateTime } from "../format.ts";
import {
  canManageSupportGrants,
  canReadAudit,
  canStartSupport,
  roleLabel,
} from "../permissions.ts";
import { useAction } from "../use-action.ts";

// ログインした後の画面の外枠: 会社名・名前・ロール・ログアウト。
export function AppHeader({ me, children }: { me: Me; children: ReactNode }) {
  const router = useRouter();
  const loggingOut = useAction();
  const ending = useAction();
  return (
    <Page>
      <Stack gap={6}>
        {me.support && (
          // 代理の社員だけに出る帯。見ている組織・見るだけ・期限をいつも見えるように
          <Alert tone="info">
            <Inline justify="between" align="center">
              <span data-testid="support-banner">
                サポートとして「{me.tenantName}」を見ています(見るだけ・
                {formatDateTime(me.support.expiresAt, me.timeZone)} まで)
              </span>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={ending.pending}
                onPress={async () => {
                  const done = await ending.run(() => api.endSupport());
                  if (!done) return;
                  router.clearCache();
                  await router.navigate({ to: "/support" });
                }}
              >
                終わる
              </Button>
            </Inline>
          </Alert>
        )}
        <header>
          <Inline justify="between" align="center">
            <Inline gap={2} align="center">
              <strong>{me.tenantName}</strong>
              <span>{me.name}</span>
              <Badge tone={me.role === "admin" ? "info" : "neutral"}>
                <span data-testid="role" data-role={me.role}>
                  {roleLabel(me.role)}
                </span>
              </Badge>
              <nav aria-label="メニュー">
                <Inline gap={3}>
                  <Link href="/">プロジェクト</Link>
                  {canReadAudit(me.role) && <Link href="/audit">監査ログ</Link>}
                  {canManageSupportGrants(me) && (
                    <Link href="/support-access">サポートへの許可</Link>
                  )}
                  {canStartSupport(me) && <Link href="/support">サポート</Link>}
                </Inline>
              </nav>
            </Inline>
            <Button
              variant="ghost"
              isDisabled={loggingOut.pending}
              onPress={async () => {
                let options: AuthOptions | undefined;
                const done = await loggingOut.run(async () => {
                  options = await api.authOptions();
                  await api.logout();
                });
                // 失敗したら(通信が切れているなど)Cookie が残るので、ログイン画面へは進まずに知らせる
                if (!done) return;
                // 前の人のデータを画面の覚え(キャッシュ)に残さない
                router.clearCache();
                // Cognito のときは、Cognito 側のログインも終わらせる(残すと次の「ログイン」で黙って同じ人に戻る)。
                // Cognito がログイン画面へ戻してくれる
                if (options?.method === "cognito") window.location.assign(options.logoutUrl);
                else await router.navigate({ to: "/login" });
              }}
            >
              ログアウト
            </Button>
          </Inline>
        </header>
        <main>{children}</main>
      </Stack>
    </Page>
  );
}
