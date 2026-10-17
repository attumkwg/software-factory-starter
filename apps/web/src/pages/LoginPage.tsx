import { Button, Card, Heading, Muted, Page, Stack, TextField } from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";

// 開発環境(local / preview)だけの簡易ログイン。本番は Cognito のホスト UI に飛ばす(差し替え口は API 側)。
const DEV_USERS = ["admin@acme.test", "member@acme.test", "viewer@acme.test", "admin@globex.test"];

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [email, setEmail] = useState(DEV_USERS[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.devLogin(email);
      await onLoggedIn();
    } catch {
      setError("ログインできませんでした");
    }
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
                <Button type="submit" variant="primary">
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
