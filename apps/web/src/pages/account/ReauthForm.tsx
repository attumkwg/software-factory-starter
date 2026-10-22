import { Stack } from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { useAction } from "../../use-action.ts";
import { CodeField, FormError, PasswordField, Submit } from "../auth/fields.tsx";

/**
 * パスワード(と、二段階認証が有効ならいまのコード)を入れ直す。通ると10分だけ、大事な所を変えられる
 * (札は JS から読めない Cookie。ADR 0023)。
 */
export function ReauthForm(props: { mfaEnabled: boolean; onDone: () => void | Promise<void> }) {
  const action = useAction();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => api.reauth(password, props.mfaEnabled ? code : undefined), {
      showErrorAs: "inline",
    });
    setPassword("");
    setCode("");
    if (ok) await props.onDone();
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap={4}>
        <FormError message={action.errorMessage ?? null} />
        <PasswordField kind="current" value={password} onChange={setPassword} />
        {props.mfaEnabled && <TotpField value={code} onChange={setCode} />}
        <Submit pending={action.pending}>パスワードを確かめる</Submit>
      </Stack>
    </form>
  );
}

/** 認証アプリのコード(6桁) */
export function TotpField(props: { value: string; onChange: (v: string) => void }) {
  return (
    <CodeField
      label="確認コード(認証アプリ)"
      description="認証アプリに出ている6桁の数字"
      value={props.value}
      onChange={props.onChange}
    />
  );
}
