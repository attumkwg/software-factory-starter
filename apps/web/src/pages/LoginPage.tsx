import type { AuthOptions } from "@app/shared";
import { Alert, Button, Card, Heading, Muted, Page, Stack, TextField } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";
import { describeError, errorText } from "../errors.ts";
import { ERROR_MESSAGES } from "../messages.ts";

// ログインの画面。方式(GET /api/auth/options)で出し方を変える。
//   cognito … 「ログイン」で Cognito の画面へ移る(ページごとの移動)。トークンは API が受け取り、画面には来ない
//   dev     … 開発環境(local / preview)だけの簡易ログイン。メールアドレスだけ

/** Cognito から戻ったときに API が付ける失敗(/login?error=...) */
export const LOGIN_PAGE_ERRORS = ["login_failed", "service_unavailable", "internal"] as const;
export type LoginPageError = (typeof LOGIN_PAGE_ERRORS)[number];

// 種データ(apps/api/src/db/seed.ts)の人
const DEV_USERS = ["admin@acme.test", "member@acme.test", "viewer@acme.test", "admin@globex.test"];

type Props = { options: AuthOptions; error?: LoginPageError; returnTo: string };

export function LoginPage({ options, error, returnTo }: Props) {
  return (
    <Page>
      <main>
        <Card>
          {options.method === "cognito" ? (
            <CognitoLogin error={error} returnTo={returnTo} />
          ) : (
            <DevLogin returnTo={returnTo} />
          )}
        </Card>
      </main>
    </Page>
  );
}

function CognitoLogin({ error, returnTo }: { error?: LoginPageError; returnTo: string }) {
  const [moving, setMoving] = useState(false);
  return (
    <Stack gap={4}>
      <Heading level={1}>ログイン</Heading>
      {/* どこが違ったかは言わない(messages.ts の決まり 2)。固定の文だけ */}
      {error ? <Alert>{ERROR_MESSAGES[error]}</Alert> : null}
      <Muted>ログインの画面に移ります。初めての方は、そこで登録もできます。</Muted>
      <div>
        <Button
          variant="primary"
          isDisabled={moving}
          onPress={() => {
            setMoving(true);
            // API が途中の状態(state・nonce・PKCE)を Cookie に置いて、Cognito の画面へ送る
            window.location.assign(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
          }}
        >
          ログイン
        </Button>
      </div>
    </Stack>
  );
}

function DevLogin({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(DEV_USERS[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await api.devLogin(email);
    } catch (err) {
      // どこが違ったか(その人がいない・パスワードが違う)は言わない(messages.ts の決まり 2)。
      // 「こちらが止まっている・通信が切れている」は、登録の有無と関係ないので分けて伝える
      setError(errorText(describeError(err)));
      return;
    } finally {
      setPending(false);
    }
    router.clearCache();
    await router.navigate({ href: returnTo });
  }

  return (
    <form onSubmit={submit}>
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
        <div>
          <Button type="submit" variant="primary" isDisabled={pending}>
            ログイン
          </Button>
        </div>
      </Stack>
    </form>
  );
}
