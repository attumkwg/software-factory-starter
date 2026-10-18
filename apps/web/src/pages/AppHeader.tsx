import type { Me } from "@app/shared";
import { Badge, Button, Inline, Page, Stack } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import { roleLabel } from "../permissions.ts";
import { useAction } from "../use-action.ts";

// ログインした後の画面の外枠: 会社名・名前・ロール・ログアウト。
export function AppHeader({ me, children }: { me: Me; children: ReactNode }) {
  const router = useRouter();
  const loggingOut = useAction();
  return (
    <Page>
      <Stack gap={6}>
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
            </Inline>
            <Button
              variant="ghost"
              isDisabled={loggingOut.pending}
              onPress={async () => {
                // 失敗したら(通信が切れているなど)Cookie が残るので、ログイン画面へは進まずに知らせる
                if (!(await loggingOut.run(() => api.logout()))) return;
                // 前の人のデータを画面の覚え(キャッシュ)に残さない
                router.clearCache();
                await router.navigate({ to: "/login" });
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
