import { FakeCognito, sendMailViaSmtp } from "./fake.ts";
import { serve } from "./serve.ts";

// 偽物の Cognito を立てる(docker compose の fake-cognito)。設定は環境変数から。**本番では使わない**。
//   FAKE_COGNITO_BASE_URL    … API から届くこの偽物の URL(発行元の頭。既定 http://fake-cognito:9231)
//   FAKE_COGNITO_USER_POOL_ID / FAKE_COGNITO_CLIENT_ID … API の COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID と同じ値
//   FAKE_COGNITO_SMTP_URL    … 確認コードのメールを渡す先(手元は Postfix → Mailpit)。無ければ送らない
//   FAKE_COGNITO_MAIL_FROM   … 送り元(Postfix が許すドメイン)

const env = process.env;
const baseUrl = env.FAKE_COGNITO_BASE_URL ?? "http://fake-cognito:9231";
const port = Number(new URL(baseUrl).port || 9231);

const fake = new FakeCognito({
  baseUrl,
  userPoolId: env.FAKE_COGNITO_USER_POOL_ID,
  clientId: env.FAKE_COGNITO_CLIENT_ID ?? "local-web-client",
  sendMail: env.FAKE_COGNITO_SMTP_URL
    ? sendMailViaSmtp(
        env.FAKE_COGNITO_SMTP_URL,
        env.FAKE_COGNITO_MAIL_FROM ?? "no-reply@example.test",
      )
    : undefined,
});

await serve(fake.fetch, port);
process.stdout.write(
  `${JSON.stringify({ level: "info", service: "fake-cognito", issuer: fake.issuer, port, message: "偽物の Cognito を立てました(開発専用)" })}\n`,
);
