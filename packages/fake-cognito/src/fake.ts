import { createHash, generateKeyPairSync, type KeyObject, randomUUID, sign } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// 開発とテスト専用の「偽物の Cognito」。本物の Cognito の画面(Managed Login)と同じ入口を持つ。
//
//   GET  /oauth2/authorize   … ログインの画面(メールアドレスを選ぶだけ。パスワードは無い)
//   POST /oauth2/authorize   … 選んだ人で、戻り先に code を付けて返す
//   POST /oauth2/token       … code を ID トークンに替える(PKCE を確かめる・code は1回だけ)
//   GET  /<プール>/.well-known/jwks.json … 署名を確かめる公開鍵
//   GET  /logout             … ログアウト(戻り先へ返すだけ)
//
// 本物と同じく、client_id・戻り先・PKCE・nonce を確かめる。ここを甘くすると、API 側の確かめ漏れに気づけない。
// 依存は Node の標準だけ(テストからも docker compose からも、そのまま動く)。**本番では使わない**。
// ─────────────────────────────────────────────────────────────────────────────

export type FakeCognitoOptions = {
  /** ブラウザからも API からも届く、この偽物の URL(例: http://fake-cognito.localhost:9231) */
  baseUrl: string;
  /** 本物のユーザープール ID の代わり。発行元(iss)は `${baseUrl}/${userPoolId}` */
  userPoolId?: string;
  clientId: string;
  /** code を返してよい戻り先(本物のアプリクライアントの callback_urls) */
  callbackUrls: string[];
  /** ログアウトの後に返してよい先(logout_urls) */
  logoutUrls: string[];
  /** ログインの画面に並べるメールアドレス(種データの人) */
  suggestedEmails?: string[];
  /** テスト用: 時計を止める */
  now?: () => number;
};

type PendingCode = {
  clientId: string;
  redirectUri: string;
  nonce: string | null;
  challenge: string;
  email: string;
  emailVerified: boolean;
  expiresAt: number;
};

const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_S = 15 * 60;

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** 同じメールなら毎回同じ sub(本物の Cognito も、人ごとに変わらない ID を返す) */
export function fakeSub(email: string): string {
  const h = createHash("sha256").update(email.toLowerCase()).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );

export class FakeCognito {
  readonly issuer: string;
  readonly #opts: FakeCognitoOptions;
  readonly #privateKey: KeyObject;
  readonly #jwk: Record<string, unknown>;
  readonly #codes = new Map<string, PendingCode>();

  constructor(opts: FakeCognitoOptions) {
    this.#opts = opts;
    this.issuer = `${opts.baseUrl}/${opts.userPoolId ?? "local_fakepool"}`;
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.#privateKey = privateKey;
    this.#jwk = { ...publicKey.export({ format: "jwk" }), kid: "fake-1", alg: "RS256", use: "sig" };
  }

  /** 公開鍵(テストでは createLocalJWKSet に渡す) */
  get jwks(): { keys: Record<string, unknown>[] } {
    return { keys: [this.#jwk] };
  }

  #now() {
    return this.#opts.now?.() ?? Date.now();
  }

  /** Web 標準の Request → Response(テストからはこれを直接呼ぶ) */
  fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/oauth2/authorize" && req.method === "GET") return this.#authorizePage(url);
    if (path === "/oauth2/authorize" && req.method === "POST") return this.#authorize(req);
    if (path === "/oauth2/token" && req.method === "POST") return this.#token(req);
    if (path === new URL(`${this.issuer}/.well-known/jwks.json`).pathname)
      return Response.json(this.jwks);
    if (path === "/logout" && req.method === "GET") return this.#logout(url);
    if (path === "/healthz") return new Response("ok");
    return new Response("not found", { status: 404 });
  };

  #badRequest(message: string) {
    // 本物と同じく、戻り先が確かめられないときは戻さずに、その場でエラーを出す
    return new Response(`偽物の Cognito: ${message}`, {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  /** client_id と戻り先が登録どおりか。本物の Cognito もここで止める */
  #checkClient(params: URLSearchParams): string | null {
    if (params.get("client_id") !== this.#opts.clientId) return "client_id が違います";
    if (!this.#opts.callbackUrls.includes(params.get("redirect_uri") ?? ""))
      return "redirect_uri が登録されていません";
    if (params.get("response_type") !== "code") return "response_type は code だけです";
    if (!params.get("code_challenge") || params.get("code_challenge_method") !== "S256")
      return "PKCE(S256)が要ります";
    return null;
  }

  #authorizePage(url: URL) {
    const problem = this.#checkClient(url.searchParams);
    if (problem) return this.#badRequest(problem);
    const hidden = [...url.searchParams]
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
      .join("");
    const choices = (this.#opts.suggestedEmails ?? [])
      .map((e) => `<option value="${escapeHtml(e)}"></option>`)
      .join("");
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>偽物の Cognito</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem}
label{display:block;margin:.75rem 0}input[type=email]{width:100%;padding:.5rem;font-size:1rem}
button{padding:.5rem 1rem;font-size:1rem;margin-right:.5rem}.note{color:#555;font-size:.875rem}</style></head>
<body><h1>偽物の Cognito</h1>
<p class="note">開発用です。本番では Cognito の画面(Managed Login)が出ます。パスワードはありません。</p>
<form method="post" action="/oauth2/authorize">${hidden}
<label>メールアドレス<input type="email" name="email" list="suggested" required autofocus></label>
<datalist id="suggested">${choices}</datalist>
<label><input type="checkbox" name="email_verified" value="true" checked> メールアドレスは確認済み</label>
<button type="submit" name="action" value="login">ログイン</button>
<button type="submit" name="action" value="cancel" formnovalidate>やめる</button>
</form></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  async #authorize(req: Request) {
    const form = new URLSearchParams(await req.text());
    const problem = this.#checkClient(form);
    if (problem) return this.#badRequest(problem);
    const back = new URL(form.get("redirect_uri") ?? "");
    const state = form.get("state");
    if (state !== null) back.searchParams.set("state", state);
    if (form.get("action") === "cancel") {
      back.searchParams.set("error", "access_denied");
      return Response.redirect(back.toString(), 302);
    }
    const email = (form.get("email") ?? "").trim().toLowerCase();
    if (!email.includes("@")) return this.#badRequest("メールアドレスを入れてください");
    const code = randomUUID();
    this.#codes.set(code, {
      clientId: form.get("client_id") ?? "",
      redirectUri: form.get("redirect_uri") ?? "",
      nonce: form.get("nonce"),
      challenge: form.get("code_challenge") ?? "",
      email,
      emailVerified: form.get("email_verified") === "true",
      expiresAt: this.#now() + CODE_TTL_MS,
    });
    back.searchParams.set("code", code);
    return Response.redirect(back.toString(), 302);
  }

  async #token(req: Request) {
    const invalid = (error: string) => Response.json({ error }, { status: 400 });
    const form = new URLSearchParams(await req.text());
    if (form.get("grant_type") !== "authorization_code") return invalid("unsupported_grant_type");
    const code = form.get("code") ?? "";
    const pending = this.#codes.get(code);
    // code は1回だけ(使ったら消す。2回目は invalid_grant)
    this.#codes.delete(code);
    if (!pending || pending.expiresAt < this.#now()) return invalid("invalid_grant");
    if (form.get("client_id") !== pending.clientId) return invalid("invalid_client");
    if (form.get("redirect_uri") !== pending.redirectUri) return invalid("invalid_grant");
    const verifier = form.get("code_verifier") ?? "";
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    if (challenge !== pending.challenge) return invalid("invalid_grant");

    const now = Math.floor(this.#now() / 1000);
    const idToken = this.signIdToken({
      sub: fakeSub(pending.email),
      aud: pending.clientId,
      email: pending.email,
      email_verified: pending.emailVerified,
      ...(pending.nonce ? { nonce: pending.nonce } : {}),
      iat: now,
      exp: now + TOKEN_TTL_S,
    });
    return Response.json({
      id_token: idToken,
      access_token: "fake-access-token",
      token_type: "Bearer",
      expires_in: TOKEN_TTL_S,
    });
  }

  #logout(url: URL) {
    if (url.searchParams.get("client_id") !== this.#opts.clientId)
      return this.#badRequest("client_id が違います");
    const to = url.searchParams.get("logout_uri") ?? "";
    if (!this.#opts.logoutUrls.includes(to))
      return this.#badRequest("logout_uri が登録されていません");
    return Response.redirect(to, 302);
  }

  /** ID トークンを作る(テストで「変なトークン」を作るときにも使う)。iss と token_use は既定で本物と同じ */
  signIdToken(claims: Record<string, unknown>, opts: { kid?: string } = {}): string {
    const header = { alg: "RS256", typ: "JWT", kid: opts.kid ?? "fake-1" };
    const body = { iss: this.issuer, token_use: "id", ...claims };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
    return `${input}.${b64url(sign("sha256", Buffer.from(input), this.#privateKey))}`;
  }
}
