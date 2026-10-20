import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";

const base = { DATABASE_URL: "postgres://x", SESSION_SECRET: "s".repeat(32) };
const cognito = {
  AUTH_MODE: "cognito",
  COGNITO_REGION: "ap-northeast-1",
  COGNITO_USER_POOL_ID: "p",
  COGNITO_CLIENT_ID: "c",
  APP_URL: "https://app.example.com",
  MAIL_SMTP_URL: "smtp://mail:25",
};

describe("設定", () => {
  it.each(["stg", "prod"])("開発用ログインは %s では起動しない", (APP_ENV) => {
    expect(() => loadConfig({ ...base, APP_ENV, AUTH_MODE: "dev" })).toThrow(/開発用ログイン/);
  });

  it.each(["local", "test", "preview"])("開発用ログインは %s では使える", (APP_ENV) => {
    expect(loadConfig({ ...base, APP_ENV, AUTH_MODE: "dev" }).auth.mode).toBe("dev");
  });

  it("cognito は設定がそろっていないと起動しない", () => {
    expect(() => loadConfig({ ...base, APP_ENV: "prod", AUTH_MODE: "cognito" })).toThrow(/COGNITO/);
  });

  it("Cookie は手元とテスト以外では Secure、本番では OpenAPI を出さない", () => {
    const prod = loadConfig({ ...base, ...cognito, APP_ENV: "prod" });
    expect(prod.session.secureCookie).toBe(true);
    expect(prod.exposeOpenApi).toBe(false);
    expect(loadConfig({ ...base, APP_ENV: "local" }).session.secureCookie).toBe(false);
  });

  it("偽物の Cognito(入口の差し替え)は手元とテストだけ", () => {
    const fake = { ...cognito, COGNITO_ENDPOINT: "http://fake-cognito:9231" };
    expect(() => loadConfig({ ...base, ...fake, APP_ENV: "stg" })).toThrow(/COGNITO_ENDPOINT/);
    expect(loadConfig({ ...base, ...fake, APP_ENV: "local" }).auth).toMatchObject({
      endpoint: "http://fake-cognito:9231",
    });
  });

  it("stg と prod では、画面の URL は https だけ", () => {
    expect(() =>
      loadConfig({ ...base, ...cognito, APP_ENV: "stg", APP_URL: "http://app.example.com" }),
    ).toThrow(/APP_URL/);
  });

  it.each(["stg", "prod"])("%s はメールの送り先と画面の URL が無いと起動しない", (APP_ENV) => {
    const { MAIL_SMTP_URL: _m, ...noMail } = cognito;
    expect(() => loadConfig({ ...base, ...noMail, APP_ENV })).toThrow(/MAIL_SMTP_URL/);
    const { APP_URL: _a, ...noUrl } = cognito;
    expect(() => loadConfig({ ...base, ...noUrl, APP_ENV })).toThrow(/APP_URL/);
  });

  it("Sentry の送り先は、手元とテスト以外では https だけ・無ければ送らない", () => {
    const dsn = "http://public@localhost:9999/1";
    expect(() => loadConfig({ ...base, ...cognito, APP_ENV: "prod", SENTRY_DSN: dsn })).toThrow(
      /SENTRY_DSN/,
    );
    expect(loadConfig({ ...base, APP_ENV: "local", SENTRY_DSN: dsn }).sentry.dsn).toBe(dsn);
    expect(loadConfig({ ...base, APP_ENV: "local" }).sentry.dsn).toBeUndefined();
  });

  it("手元では、メールの送り先が無ければ送らずに記録だけ", () => {
    const local = loadConfig({ ...base, APP_ENV: "local" });
    expect(local.mail.smtpUrl).toBeNull();
    expect(local.appUrl).toBe("http://localhost:8080");
  });

  // 決まりを全部まとめて破ったときの答え(どの決まりも、この順で全部出る)
  it("決まりの破れは、まとめて全部・決まった順で出る", () => {
    const broken = {
      ...base,
      APP_ENV: "stg",
      AUTH_MODE: "cognito",
      COGNITO_ENDPOINT: "http://fake-cognito:9231/",
      SENTRY_DSN: "http://public@localhost:9999/1",
    };
    expect(() => loadConfig(broken)).toThrow(
      [
        "設定が正しくありません:",
        "- MAIL_SMTP_URL: stg ではメールを送る先(MAIL_SMTP_URL)が要ります",
        "- APP_URL: stg では画面の URL(APP_URL。メールのリンクに使う)が要ります",
        "- SENTRY_DSN: SENTRY_DSN は https:// にしてください",
        "- AUTH_MODE: cognito には COGNITO_REGION / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID が要ります",
        "- COGNITO_ENDPOINT: COGNITO_ENDPOINT(偽物の Cognito)は local / test だけで使えます",
        "- COGNITO_ENDPOINT: COGNITO_ENDPOINT は https:// にしてください",
        "- COGNITO_ENDPOINT: COGNITO_ENDPOINT の最後に / を付けないでください",
      ].join("\n"),
    );
    expect(() =>
      loadConfig({ ...base, APP_ENV: "prod", AUTH_MODE: "dev", APP_URL: "https://a.example.com/" }),
    ).toThrow(
      [
        "設定が正しくありません:",
        "- AUTH_MODE: 開発用ログインは prod では使えません(local / test / preview だけ)",
        "- MAIL_SMTP_URL: prod ではメールを送る先(MAIL_SMTP_URL)が要ります",
      ].join("\n"),
    );
    expect(() =>
      loadConfig({ ...base, ...cognito, APP_ENV: "local", APP_URL: "http://localhost:8080/" }),
    ).toThrow("- APP_URL: APP_URL の最後に / を付けないでください");
  });

  it("短すぎるセッションの秘密は通さない", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });
});
