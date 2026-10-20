import type { Account } from "@app/shared";
import { Card, Heading, Muted, Stack } from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { useAction } from "../../use-action.ts";
import { FormError, PasswordField, Submit } from "../auth/fields.tsx";
import { TotpField } from "./ReauthForm.tsx";

// パスワードの変更: いまのパスワード(有効なら認証アプリのコードも)と新しいパスワードを1回で送る。
// 変えたら、ほかの端末のログインは切れ、本人にお知らせのメールが届く。

export function PasswordCard({ account }: { account: Account }) {
  const action = useAction();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await action.run(
      () => api.changePassword(current, next, account.mfaEnabled ? code : undefined),
      { success: "パスワードを変えました", showErrorAs: "inline" },
    );
    setCurrent("");
    setCode("");
    if (ok) setNext("");
  }

  return (
    <Card>
      <form onSubmit={onSubmit}>
        <Stack gap={4}>
          <Heading level={2}>パスワード</Heading>
          <Muted>変えると、ほかの端末・ブラウザのログインは切れます。</Muted>
          <FormError message={action.errorMessage ?? null} />
          <PasswordField kind="current" value={current} onChange={setCurrent} />
          {account.mfaEnabled && <TotpField value={code} onChange={setCode} />}
          <PasswordField kind="new" value={next} onChange={setNext} />
          <Submit pending={action.pending}>パスワードを変える</Submit>
        </Stack>
      </form>
    </Card>
  );
}
