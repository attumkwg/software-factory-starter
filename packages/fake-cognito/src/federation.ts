import { createHash, randomBytes } from "node:crypto";
import type { UserPool } from "./pool.ts";

// ─────────────────────────────────────────────────────────────────────────────
// SSO の偽物: Cognito の OAuth の入口(/oauth2/authorize・/oauth2/token)と、つないだ IdP の代わりの画面。
//   authorize … identity_provider で名指しされた IdP が、つないであり・アプリクライアントの一覧にあれば、
//               「テスト用の IdP」の画面(メールを入れるだけ)を返す。本物は SAML の IdP へ回る
//   IdP の画面 … メールを入れると、コードを付けて redirect_uri へ戻す(本物は IdP の主張を Cognito が確かめた後)
//   token     … コードと PKCE(S256)を確かめ、IdP から来た人の ID トークン(identities つき)を返す。1回きり・5分
// IdP から来た人の sub は IdP とメールごとに決まる(本物は Cognito がその人を作った時の sub)。email_verified は付けない。
// **SAML そのものは真似しない**(署名・主張の確かめは Cognito の仕事。本物は stg で人が確かめる。設計書 0056 の U-8)。
// ─────────────────────────────────────────────────────────────────────────────

const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_S = 15 * 60;

type Authorize = {
  clientId: string;
  redirectUri: string;
  provider: string;
  state: string;
  codeChallenge: string;
};

type IssuedCode = Authorize & { email: string; expiresAt: number };

const b64url = (buf: Buffer) => buf.toString("base64url");
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export class Federation {
  readonly #pool: UserPool;
  readonly #codes = new Map<string, IssuedCode>();

  constructor(pool: UserPool) {
    this.#pool = pool;
  }

  /** この入口で答えるか(答えないなら null) */
  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/oauth2/authorize") return this.#authorize(url);
    if (req.method === "POST" && url.pathname === "/fake-idp/sign-in") {
      return this.#signIn(new URLSearchParams(await req.text()));
    }
    if (req.method === "POST" && url.pathname === "/oauth2/token") {
      return this.#token(new URLSearchParams(await req.text()));
    }
    return null;
  }

  /** テスト用: IdP の画面を通さずにコードを出す(結合テストが IdP の画面の代わりに使う) */
  issueCode(params: URLSearchParams, email: string): string {
    const a = this.#readAuthorize(params);
    if (typeof a === "string") throw new Error(a);
    return this.#issue(a, email);
  }

  #readAuthorize(q: URLSearchParams): Authorize | string {
    const a = {
      clientId: q.get("client_id") ?? "",
      redirectUri: q.get("redirect_uri") ?? "",
      provider: q.get("identity_provider") ?? "",
      state: q.get("state") ?? "",
      codeChallenge: q.get("code_challenge") ?? "",
    };
    if (q.get("response_type") !== "code") return "unsupported_response_type";
    if (a.clientId !== this.#pool.clientId) return "invalid_client";
    if (!this.#pool.identityProviders.has(a.provider)) return "invalid_request";
    if (!this.#pool.supportedIdentityProviders.includes(a.provider)) return "unauthorized_client";
    if (!a.codeChallenge || q.get("code_challenge_method") !== "S256") return "invalid_request";
    if (!/^https?:\/\//.test(a.redirectUri)) return "invalid_request";
    return a;
  }

  #authorize(url: URL): Response {
    const a = this.#readAuthorize(url.searchParams);
    if (typeof a === "string") return Response.json({ error: a }, { status: 400 });
    const hidden = [...url.searchParams]
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
      .join("");
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>テスト用の IdP</title></head>
<body><main><h1>テスト用の IdP(${escapeHtml(a.provider)})</h1>
<p>開発とテスト専用。会社のアカウントの代わりに、メールアドレスだけで戻ります。</p>
<form method="post" action="/fake-idp/sign-in">${hidden}
<label>会社のメールアドレス <input type="email" name="email" required></label>
<button type="submit">会社のアカウントでログイン</button></form></main></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  #signIn(form: URLSearchParams): Response {
    const a = this.#readAuthorize(form);
    const email = (form.get("email") ?? "").trim().toLowerCase();
    if (typeof a === "string" || !email.includes("@")) {
      return Response.json(
        { error: typeof a === "string" ? a : "invalid_request" },
        { status: 400 },
      );
    }
    const back = new URL(a.redirectUri);
    back.searchParams.set("code", this.#issue(a, email));
    back.searchParams.set("state", a.state);
    return new Response(null, { status: 302, headers: { location: back.toString() } });
  }

  #issue(a: Authorize, email: string): string {
    const code = b64url(randomBytes(24));
    this.#codes.set(code, { ...a, email, expiresAt: this.#pool.now() + CODE_TTL_MS });
    return code;
  }

  #token(form: URLSearchParams): Response {
    const fail = (error: string) => Response.json({ error }, { status: 400 });
    if (form.get("grant_type") !== "authorization_code") return fail("unsupported_grant_type");
    const code = form.get("code") ?? "";
    const issued = this.#codes.get(code);
    // 1回きり(本物と同じく、使ったコード・違うコードは invalid_grant)
    this.#codes.delete(code);
    if (!issued || issued.expiresAt < this.#pool.now()) return fail("invalid_grant");
    if (form.get("client_id") !== issued.clientId) return fail("invalid_client");
    if (form.get("redirect_uri") !== issued.redirectUri) return fail("invalid_grant");
    const challenge = b64url(
      createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest(),
    );
    if (challenge !== issued.codeChallenge) return fail("invalid_grant");
    return Response.json({
      id_token: this.#idToken(issued),
      access_token: b64url(randomBytes(32)),
      token_type: "Bearer",
      expires_in: TOKEN_TTL_S,
    });
  }

  #idToken(issued: IssuedCode): string {
    const now = Math.floor(this.#pool.now() / 1000);
    const sub = federatedSub(issued.provider, issued.email);
    return this.#pool.signIdToken({
      sub,
      aud: issued.clientId,
      email: issued.email,
      "cognito:username": `${issued.provider}_${issued.email}`,
      identities: [
        {
          userId: issued.email,
          providerName: issued.provider,
          providerType: "SAML",
          primary: "true",
          dateCreated: String(now * 1000),
        },
      ],
      auth_time: now,
      iat: now,
      exp: now + TOKEN_TTL_S,
    });
  }
}

/** IdP から来た人の sub(IdP とメールで決まる。パスワードの人の sub とは別) */
export function federatedSub(provider: string, email: string): string {
  const h = createHash("sha256").update(`federated:${provider}:${email}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
