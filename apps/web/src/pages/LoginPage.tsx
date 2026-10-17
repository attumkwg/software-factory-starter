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
    <main className="container">
      <h1>ログイン</h1>
      <p className="note">開発用ログイン(local / preview だけ)。パスワードはありません。</p>
      <form onSubmit={submit} className="row">
        <label>
          メールアドレス
          <input
            name="email"
            list="dev-users"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </label>
        <datalist id="dev-users">
          {DEV_USERS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <button type="submit">ログイン</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
