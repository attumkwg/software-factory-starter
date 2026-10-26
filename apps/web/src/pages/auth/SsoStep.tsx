import { Button, Muted, Stack } from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { EmailField, Submit } from "./fields.tsx";
import { useSubmit } from "./use-submit.ts";

// ログインの画面の「会社のアカウントでログイン」の段(docs/designs/0056-sso-scim-ip-audit-export.md の 0)。
// メールを API に渡し、SSO の組織なら IdP(Cognito の入口)へ移る。そうでなければパスワードの段へ戻す。
// 人がいるかは API も画面も言わない(SSO のドメインかどうかだけ)。メールは URL に載せない。

type Props = {
  email: string;
  onEmailChange: (v: string) => void;
  /** SSO のドメインではなかった・パスワードで入りたい → パスワードの段へ */
  onPassword: (notSso: boolean) => void;
  /** IdP へ移る(テストで差し替える。既定はブラウザの移動) */
  go?: (url: string) => void;
};

export function SsoStep({ email, onEmailChange, onPassword, go = toIdp }: Props) {
  const { submit, pending, error } = useSubmit();
  const [leaving, setLeaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = await submit(() => api.ssoStart(email));
    if (!r) return;
    if (r.next === "redirect") {
      setLeaving(true);
      go(r.url);
      return;
    }
    onPassword(true);
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap={4}>
        <Muted>会社のメールアドレスを入れると、会社のログインの画面へ移ります。</Muted>
        <EmailField value={email} onChange={onEmailChange} />
        {error ? <Muted>{error}</Muted> : null}
        <Submit pending={pending || leaving}>会社のアカウントへ進む</Submit>
        <div>
          <Button variant="ghost" onPress={() => onPassword(false)} isDisabled={pending}>
            パスワードでログイン
          </Button>
        </div>
      </Stack>
    </form>
  );
}

function toIdp(url: string) {
  window.location.assign(url);
}
