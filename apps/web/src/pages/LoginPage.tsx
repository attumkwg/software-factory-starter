import { Button, Card, Heading, Muted, Page, Stack, TextField } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api, HttpError } from "../api.ts";
import { describeError, errorText } from "../errors.ts";

// 開発環境(local / preview)だけの簡易ログイン。本番は Cognito のホスト UI に飛ばす(差し替え口は API 側)。
const DEV_USERS = ["admin@acme.test", "member@acme.test", "viewer@acme.test", "admin@globex.test"];

export function LoginPage() {
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
      // 「その人はいない」と「こちらが壊れている・通信が切れている」を分けて伝える
      setError(
        err instanceof HttpError && err.code === "login_failed"
          ? "ログインできませんでした。メールアドレスを確かめてください"
          : errorText(describeError(err)),
      );
      return;
    } finally {
      setPending(false);
    }
    router.clearCache();
    await router.navigate({ to: "/" });
  }

  return (
    <Page>
      <main>
        <Card>
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
        </Card>
      </main>
    </Page>
  );
}
