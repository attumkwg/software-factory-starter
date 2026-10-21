import {
  currentVersion,
  LEGAL_DOCUMENTS,
  type LegalVersionRef,
  passwordProblems,
} from "@app/shared";
import { Alert, Button, Card, Checkbox, Heading, Inline, Link, Muted, Page, Stack } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";
import { AUTH_NOTICES } from "../messages.ts";
import { CodeField, EmailField, FormError, PasswordField, Submit } from "./auth/fields.tsx";
import { useSubmit } from "./auth/use-submit.ts";

// 登録の画面: メールとパスワード → 届いた確認コード → ログイン画面へ。
// 誰でも登録できる。アプリに入れるのは、組織の管理者が users に足した人だけ(ADR 0007)。
// もう登録されているメールでも同じ答え(登録の有無が分からない)。
// 利用規約とプライバシーポリシーのいまの版への同意のチェックが要る。記録は確認コードが通った後に API が残す
// (docs/specs/0009-legal-consent.md)。

/** 登録の画面で見せる版(いま効いている版) */
function shownVersions(): LegalVersionRef[] {
  const now = new Date();
  return LEGAL_DOCUMENTS.flatMap((document) => {
    const version = currentVersion(document, now)?.version;
    return version === undefined ? [] : [{ document, version }];
  });
}

export function SignUpPage({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const [info, setInfo] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  async function onForm(e: FormEvent) {
    e.preventDefault();
    if (!agreed) return;
    // 決まりは先に画面で知らせる(最後に確かめるのは Cognito)
    const problems = passwordProblems(password);
    setPasswordError(problems.length > 0 ? `足りないもの: ${problems.join("・")}` : undefined);
    if (problems.length > 0) return;
    const r = await submit(() => api.signUp(email, password));
    if (!r) return;
    setInfo(AUTH_NOTICES.codeSent);
    setStep("confirm");
  }

  async function onConfirm(e: FormEvent) {
    e.preventDefault();
    const r = await submit(() => api.confirmSignUp(email, code, shownVersions()));
    if (!r) return;
    await router.navigate({ to: "/login", search: { notice: "registered", returnTo } });
  }

  async function resend() {
    const r = await submit(() => api.resendCode(email));
    if (r) setInfo(AUTH_NOTICES.codeSent);
  }

  return (
    <Page>
      <main>
        <Card>
          <Stack gap={4}>
            <Heading level={1}>登録</Heading>
            {info ? <Alert tone="info">{info}</Alert> : null}
            <FormError message={error} />
            {step === "form" ? (
              <form onSubmit={onForm}>
                <Stack gap={4}>
                  <EmailField value={email} onChange={setEmail} />
                  <PasswordField
                    kind="new"
                    value={password}
                    onChange={setPassword}
                    errorMessage={passwordError}
                  />
                  <Stack gap={2}>
                    <Checkbox isSelected={agreed} onChange={setAgreed} strikeWhenSelected={false}>
                      利用規約とプライバシーポリシーに同意します
                    </Checkbox>
                    <Inline gap={3}>
                      <Link href="/legal/terms" target="_blank" rel="noopener">
                        利用規約を読む(新しいタブ)
                      </Link>
                      <Link href="/legal/privacy" target="_blank" rel="noopener">
                        プライバシーポリシーを読む(新しいタブ)
                      </Link>
                    </Inline>
                  </Stack>
                  <Submit pending={pending} isDisabled={!agreed}>
                    登録する
                  </Submit>
                  <Link href="/login">ログインに戻る</Link>
                </Stack>
              </form>
            ) : (
              <form onSubmit={onConfirm}>
                <Stack gap={4}>
                  <Muted>届いたメールの確認コードを入れてください。</Muted>
                  <CodeField
                    label="確認コード(メール)"
                    description="メールに書かれた6桁の数字"
                    value={code}
                    onChange={setCode}
                  />
                  <Submit pending={pending}>確かめる</Submit>
                  <div>
                    <Button variant="ghost" onPress={resend} isDisabled={pending}>
                      コードを送り直す
                    </Button>
                  </div>
                </Stack>
              </form>
            )}
          </Stack>
        </Card>
      </main>
    </Page>
  );
}
