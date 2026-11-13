import type { AuthOptions, Me } from "@app/shared";
import { Alert, Badge, Button, Inline, Link, Page, Stack } from "@app/ui";
import { useRouter, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import { formatDateTime } from "../format.ts";
import {
  canManageAccount,
  canOpenSettings,
  canStartSupport,
  canSwitchOrganization,
  roleLabel,
} from "../permissions.ts";
import { useAction } from "../use-action.ts";
import { LegalLinks, LegalNotices } from "./LegalNotices.tsx";

// ログインした後の画面の外枠: 会社名・名前・ロール・ログアウト。
export function AppHeader({ me, children }: { me: Me; children: ReactNode }) {
  const router = useRouter();
  const loggingOut = useAction();
  // いまのページをナビに示す(🎨 の棚卸しの所見 6)。設定から開く画面(組織の人・招待・監査ログ・サポートへの許可)は「設定」に
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = sectionOf(pathname);
  const current = (href: string) => (section === href ? ("page" as const) : undefined);
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
                  <Link href="/" aria-current={current("/")}>
                    プロジェクト
                  </Link>
                  {/* 管理者の画面(監査ログ・サポートへの許可・データの書き出し)は「設定」にまとめる */}
                  {canOpenSettings(me) && (
                    <Link href="/settings" aria-current={current("/settings")}>
                      設定
                    </Link>
                  )}
                  {canStartSupport(me) && (
                    <Link href="/support" aria-current={current("/support")}>
                      サポート
                    </Link>
                  )}
                  {/* 自分のアカウント(二段階認証・メール・パスワード) */}
                  {canManageAccount(me) && (
                    <Link href="/account" aria-current={current("/account")}>
                      アカウント
                    </Link>
                  )}
                  {/* 2つ以上の組織に所属している人だけ(docs/specs/0055-multi-org-membership.md) */}
                  {canSwitchOrganization(me) && (
                    <Link href="/organizations" aria-current={current("/organizations")}>
                      組織を切り替える
                    </Link>
                  )}
                </Inline>
              </nav>
            </Inline>
            {/* ナビのリンクと形を分ける(リンクに見えて押してしまわない。🎨 の棚卸しの所見 6) */}
            <Button
              variant="secondary"
              size="sm"
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
        <LegalNotices me={me} />
        <main>{children}</main>
        <footer>
          <LegalLinks />
        </footer>
      </Stack>
    </Page>
  );
}

/** 道から、ナビのどの項目の中にいるか */
export function sectionOf(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/projects")) return "/";
  if (
    ["/settings", "/members", "/invitations", "/audit", "/support-access"].some((p) =>
      pathname.startsWith(p),
    )
  )
    return "/settings";
  for (const p of ["/support", "/account", "/organizations"]) if (pathname.startsWith(p)) return p;
  return "";
}
