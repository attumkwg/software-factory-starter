import { passwordProblems } from "@app/shared";
import { Alert, Card, Heading, Link, Muted, Page, Stack } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";
import { AUTH_NOTICES } from "../messages.ts";
import { CodeField, EmailField, FormError, PasswordField, Submit } from "./auth/fields.tsx";
import { useSubmit } from "./auth/use-submit.ts";

// パスワードの再設定: メール → 届いたコードと新しいパスワード → ログイン画面へ。
// 登録されていないメールでも同じ答え(登録の有無が分からない)。

export function ForgotPasswordPage() {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string>();

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    const r = await submit(() => api.forgotPassword(email));
    if (r) setStep("reset");
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    const problems = passwordProblems(password);
    setPasswordError(problems.length > 0 ? `足りないもの: ${problems.join("・")}` : undefined);
    if (problems.length > 0) return;
    const r = await submit(() => api.resetPassword(email, code, password));
    if (!r) return;
    await router.navigate({ to: "/login", search: { notice: "reset" } });
  }

  return (
    <Page>
      <main>
        <Card>
          <Stack gap={4}>
            <Heading level={1}>パスワードの再設定</Heading>
            {step === "reset" ? <Alert tone="info">{AUTH_NOTICES.resetCodeSent}</Alert> : null}
            <FormError message={error} />
            {step === "email" ? (
              <form onSubmit={onEmail}>
                <Stack gap={4}>
                  <Muted>登録したメールアドレスに、確認コードを送ります。</Muted>
                  <EmailField value={email} onChange={setEmail} />
                  <Submit pending={pending}>コードを送る</Submit>
                  <Link href="/login">ログインに戻る</Link>
                </Stack>
              </form>
            ) : (
              <form onSubmit={onReset}>
                <Stack gap={4}>
                  <CodeField
                    label="確認コード(メール)"
                    description="メールに書かれた6桁の数字"
                    value={code}
                    onChange={setCode}
                  />
                  <PasswordField
                    kind="new"
                    value={password}
                    onChange={setPassword}
                    errorMessage={passwordError}
                  />
                  <Submit pending={pending}>パスワードを変える</Submit>
                </Stack>
              </form>
            )}
          </Stack>
        </Card>
      </main>
    </Page>
  );
}
