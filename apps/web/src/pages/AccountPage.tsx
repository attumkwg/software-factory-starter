import type { Account, Me } from "@app/shared";
import { Alert, Heading, Muted, Stack } from "@app/ui";
import { EmailCard } from "./account/EmailCard.tsx";
import { MfaCard } from "./account/MfaCard.tsx";
import { PasswordCard } from "./account/PasswordCard.tsx";

// 自分のアカウント(docs/specs/0006-account-security.md)。どの操作も、先にパスワードを入れ直してもらう。
// 変えたら、ほかの端末のログインは切れ、本人にお知らせのメールが届く。
export function AccountPage({ me, account }: { me: Me; account: Account | null }) {
  if (me.support) {
    return (
      <Stack gap={4}>
        <Heading level={1}>アカウント</Heading>
        <Alert tone="info">代理ログイン中は、アカウントを変えられません。</Alert>
      </Stack>
    );
  }
  if (!account) {
    return (
      <Stack gap={4}>
        <Heading level={1}>アカウント</Heading>
        <Muted>開発用ログインでは使えません(Cognito のときだけ)。</Muted>
      </Stack>
    );
  }
  return (
    <Stack gap={4}>
      <Heading level={1}>アカウント</Heading>
      {me.mfa?.setupRequired && (
        <Alert tone="info">
          この組織では二段階認証が必須です。設定するまで、ほかの画面は使えません。
        </Alert>
      )}
      <MfaCard account={account} />
      {!me.mfa?.setupRequired && (
        <>
          <EmailCard account={account} />
          <PasswordCard account={account} />
        </>
      )}
    </Stack>
  );
}
