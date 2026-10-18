import { createServer } from "node:http";
import { FakeCognito } from "./fake.ts";

// 偽物の Cognito を立てる(docker compose の fake-cognito)。設定は環境変数から。**本番では使わない**。
//   FAKE_COGNITO_BASE_URL   … ブラウザからも API からも届く URL(既定 http://fake-cognito.localhost:9231)
//   FAKE_COGNITO_CLIENT_ID  … アプリクライアントの ID(API の COGNITO_CLIENT_ID と同じ値)
//   FAKE_COGNITO_CALLBACK_URLS / FAKE_COGNITO_LOGOUT_URLS … カンマ区切り
//   FAKE_COGNITO_EMAILS     … ログインの画面に並べるメールアドレス(カンマ区切り)

const env = process.env;
const list = (v: string | undefined) => (v ?? "").split(",").filter(Boolean);
const baseUrl = env.FAKE_COGNITO_BASE_URL ?? "http://fake-cognito.localhost:9231";
const port = Number(new URL(baseUrl).port || 9231);

const fake = new FakeCognito({
  baseUrl,
  userPoolId: env.FAKE_COGNITO_USER_POOL_ID,
  clientId: env.FAKE_COGNITO_CLIENT_ID ?? "local-web-client",
  callbackUrls: list(env.FAKE_COGNITO_CALLBACK_URLS ?? "http://localhost:8080/api/auth/callback"),
  logoutUrls: list(env.FAKE_COGNITO_LOGOUT_URLS ?? "http://localhost:8080/login"),
  suggestedEmails: list(env.FAKE_COGNITO_EMAILS),
});

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const request = new Request(new URL(req.url ?? "/", baseUrl), {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) =>
      v === undefined ? [] : [[k, Array.isArray(v) ? v.join(", ") : v] as [string, string]],
    ),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  const response = await fake.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, "0.0.0.0", () => {
  process.stdout.write(
    `${JSON.stringify({ level: "info", service: "fake-cognito", issuer: fake.issuer, port, message: "偽物の Cognito を立てました(開発専用)" })}\n`,
  );
});
