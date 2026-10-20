import type { Account } from "@app/shared";
import { Button, Card, Heading, Muted, Stack, TextField } from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { useAction } from "../../use-action.ts";
import { CodeField, FormError, Submit } from "../auth/fields.tsx";
import { ReauthForm } from "./ReauthForm.tsx";

// メールアドレスの変更: パスワードを入れ直す → 新しいアドレス → 新しいアドレスに届いた確認コード。
// 確認するまでは古いアドレスのまま。変わったら古いアドレスにお知らせが届く。
// メールアドレスは URL に載せない(段は画面の中で進める)。

type Step = "idle" | "reauth" | "address" | "code";

export function EmailCard({ account }: { account: Account }) {
  const [step, setStep] = useState<Step>("idle");
  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>メールアドレス</Heading>
        <div>
          いまのアドレス: <strong data-testid="current-email">{account.email}</strong>
        </div>
        {account.pendingEmail && step === "idle" && (
          <Muted>
            {account.pendingEmail}{" "}
            への変更を申し込んでいます(確認コードを入れるまでは、いまのアドレスのままです)。
          </Muted>
        )}
        {step === "idle" && (
          <div>
            <Button onPress={() => setStep("reauth")}>メールアドレスを変える</Button>
          </div>
        )}
        {step === "reauth" && (
          <ReauthForm mfaEnabled={account.mfaEnabled} onDone={() => setStep("address")} />
        )}
        {step === "address" && <NewAddress onSent={() => setStep("code")} />}
        {step === "code" && <ConfirmCode onDone={() => setStep("idle")} />}
      </Stack>
    </Card>
  );
}

function NewAddress({ onSent }: { onSent: () => void }) {
  const action = useAction();
  const [email, setEmail] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => api.requestEmailChange(email), { showErrorAs: "inline" });
    if (ok) onSent();
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap={4}>
        <FormError message={action.errorMessage ?? null} />
        <TextField
          label="新しいメールアドレス"
          type="email"
          autoComplete="email"
          isRequired
          value={email}
          onChange={setEmail}
        />
        <Submit pending={action.pending}>確認コードを送る</Submit>
      </Stack>
    </form>
  );
}

function ConfirmCode({ onDone }: { onDone: () => void }) {
  const action = useAction();
  const [code, setCode] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => api.confirmEmailChange(code), {
      success: "メールアドレスを変えました",
      showErrorAs: "inline",
    });
    setCode("");
    if (ok) onDone();
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap={4}>
        <Muted>新しいアドレスに届いた6桁の確認コードを入れてください。</Muted>
        <FormError message={action.errorMessage ?? null} />
        <CodeField
          label="確認コード(メール)"
          description="新しいアドレスに届いたメールの6桁の数字"
          value={code}
          onChange={setCode}
        />
        <Submit pending={action.pending}>メールアドレスを変える</Submit>
      </Stack>
    </form>
  );
}
