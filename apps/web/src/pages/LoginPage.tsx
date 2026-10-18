import type { AuthOptions } from "@app/shared";
import { Alert, Button, Card, Heading, Inline, Link, Muted, Page, Stack, TextField } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api, HttpError } from "../api.ts";
import { AUTH_NOTICES } from "../messages.ts";
import { CodeField, EmailField, FormError, PasswordField, Submit } from "./auth/fields.tsx";
import { useSubmit } from "./auth/use-submit.ts";

// ログインの画面。方式(GET /api/auth/options)で出し方を変える。
//   cognito … メールとパスワード →(二段階認証のコード / 確認がまだなら確認コード)。API が Cognito に聞く
//   dev     … 開発環境(local / preview)だけの簡易ログイン。メールアドレスだけ
// メールアドレスは URL に載せない(履歴・ログに残る)。段は画面の中で進める。

export type LoginNotice = "registered" | "reset";

type Props = { options: AuthOptions; notice?: LoginNotice; returnTo: string };

export function LoginPage({ options, notice, returnTo }: Props) {
  return (
    <Page>
      <main>
        <Card>
          {options.method === "cognito" ? (
            <CognitoLogin notice={notice} returnTo={returnTo} />
          ) : (
            <DevLogin returnTo={returnTo} />
          )}
        </Card>
      </main>
    </Page>
  );
}

type Step = "password" | "mfa" | "confirm";

function CognitoLogin({ notice, returnTo }: { notice?: LoginNotice; returnTo: string }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<string | null>(notice ? AUTH_NOTICES[notice] : null);

  async function signedIn() {
    // 前の人のデータを画面の覚え(キャッシュ)に残さない
    router.clearCache();
    await router.navigate({ href: returnTo });
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setInfo(null);
    const r = await submit(() => api.login(email, password));
    if (!r) return;
    setCode("");
    if (r.next === "done") await signedIn();
    else if (r.next === "mfa") setStep("mfa");
    else if (r.next === "confirm") {
      setInfo(AUTH_NOTICES.codeSent);
      setStep("confirm");
    }
  }

  async function onMfa(e: FormEvent) {
    e.preventDefault();
    let restart = false;
    const r = await submit(async () => {
      try {
        return await api.answerMfa(code);
      } catch (err) {
        // 途中の札は1回きり。間違えても切れても、パスワードからやり直す
        restart = err instanceof HttpError && (err.code === "invalid_code" || err.status === 401);
        throw err;
      }
    });
    if (r?.next === "done") return signedIn();
    if (restart) {
      setInfo(AUTH_NOTICES.mfaRestart);
      setPassword("");
      setStep("password");
    }
  }

  async function onConfirm(e: FormEvent) {
    e.preventDefault();
    const r = await submit(() => api.confirmSignUp(email, code));
    if (!r) return;
    setPassword("");
    setInfo(AUTH_NOTICES.confirmed);
    setStep("password");
  }

  async function resend() {
    const r = await submit(() => api.resendCode(email));
    if (r) setInfo(AUTH_NOTICES.codeSent);
  }

  return (
    <Stack gap={4}>
      <Heading level={1}>ログイン</Heading>
      {info ? <Alert tone="info">{info}</Alert> : null}
      <FormError message={error} />
      {step === "password" && (
        <form onSubmit={onPassword}>
          <Stack gap={4}>
            <EmailField value={email} onChange={setEmail} />
            <PasswordField kind="current" value={password} onChange={setPassword} />
            <Submit pending={pending}>ログイン</Submit>
            <Inline gap={4}>
              <Link href={`/sign-up?returnTo=${encodeURIComponent(returnTo)}`}>
                初めての方は登録
              </Link>
              <Link href="/forgot-password">パスワードを忘れた</Link>
            </Inline>
          </Stack>
        </form>
      )}
      {step === "mfa" && (
        <form onSubmit={onMfa}>
          <Stack gap={4}>
            <CodeField
              label="確認コード(認証アプリ)"
              description="認証アプリに出ている6桁の数字"
              value={code}
              onChange={setCode}
            />
            <Submit pending={pending}>確かめる</Submit>
          </Stack>
        </form>
      )}
      {step === "confirm" && (
        <form onSubmit={onConfirm}>
          <Stack gap={4}>
            <Muted>
              メールアドレスの確認がまだです。届いたメールの確認コードを入れてください。
            </Muted>
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
  );
}

// 開発環境(local / preview)だけの簡易ログイン。本番は Cognito(上)。
const DEV_USERS = ["admin@acme.test", "member@acme.test", "viewer@acme.test", "admin@globex.test"];

function DevLogin({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(DEV_USERS[0] ?? "");
  const { submit, pending, error } = useSubmit();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await submit(() => api.devLogin(email));
    if (!ok) return;
    router.clearCache();
    await router.navigate({ href: returnTo });
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap={4}>
        <Heading level={1}>ログイン</Heading>
        <Muted>開発用ログイン(local / preview だけ)。パスワードはありません。</Muted>
        <TextField
          label="メールアドレス"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          description={`種データ: ${DEV_USERS.join(" / ")}`}
          isInvalid={error !== null}
          errorMessage={error ?? undefined}
        />
        <Submit pending={pending}>ログイン</Submit>
      </Stack>
    </form>
  );
}
