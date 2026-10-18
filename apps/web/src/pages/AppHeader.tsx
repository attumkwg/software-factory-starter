import type { Me } from "@app/shared";
import { Badge, Button, Inline, Page, Stack } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import { roleLabel } from "../permissions.ts";

// ログインした後の画面の外枠: 会社名・名前・ロール・ログアウト。
export function AppHeader({ me, children }: { me: Me; children: ReactNode }) {
  const router = useRouter();
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
              onPress={async () => {
                await api.logout();
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
