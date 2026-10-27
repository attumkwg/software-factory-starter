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
  // 写真・ファイルの置き場(stg・prod は必須。docs/designs/0072-file-storage.md)
  FILES_BUCKET: "app-prod-files-123456789012",
  FILES_ACCESS_ROLE_ARN: "arn:aws:iam::123456789012:role/app-prod-files-access",
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

  it("ログインは既定で無操作1時間・最長12時間。無操作の方が長い設定は通さない", () => {
    expect(loadConfig(base).session).toMatchObject({ idleSeconds: 3600, maxSeconds: 43200 });
    expect(() =>
      loadConfig({ ...base, SESSION_IDLE_SECONDS: "7200", SESSION_MAX_SECONDS: "3600" }),
    ).toThrow(
      "- SESSION_IDLE_SECONDS: SESSION_IDLE_SECONDS は SESSION_MAX_SECONDS 以下にしてください",
    );
  });
});

describe("要配慮個人情報の接続と鍵(ADR 0029)", () => {
  const url = "postgres://app_sensitive_login@db/app";
  const arn = "arn:aws:kms:ap-northeast-1:123456789012:key/abcd";

  it("接続が無ければ要配慮は扱わない(null)", () => {
    expect(loadConfig(base).sensitive).toBeNull();
  });

  it("手元では KMS の鍵が無くてよい(手元の包み鍵)。stg・prod では鍵が要る", () => {
    expect(loadConfig({ ...base, SENSITIVE_DATABASE_URL: url }).sensitive).toEqual({
      databaseUrl: url,
      kmsKeyArn: null,
    });
    expect(() =>
      loadConfig({ ...base, ...cognito, APP_ENV: "prod", SENSITIVE_DATABASE_URL: url }),
    ).toThrow(/SENSITIVE_KMS_KEY_ID/);
    const prod = loadConfig({
      ...base,
      ...cognito,
      APP_ENV: "prod",
      SENSITIVE_DATABASE_URL: url,
      SENSITIVE_KMS_KEY_ID: arn,
    });
    expect(prod.sensitive).toEqual({ databaseUrl: url, kmsKeyArn: arn });
  });

  it("アプリと同じ接続・ARN でない鍵・接続の無い鍵は通さない", () => {
    expect(() => loadConfig({ ...base, SENSITIVE_DATABASE_URL: base.DATABASE_URL })).toThrow(
      /別の接続ユーザー/,
    );
    expect(() =>
      loadConfig({ ...base, SENSITIVE_DATABASE_URL: url, SENSITIVE_KMS_KEY_ID: "alias/x" }),
    ).toThrow(/ARN/);
    expect(() => loadConfig({ ...base, SENSITIVE_KMS_KEY_ID: arn })).toThrow(
      /SENSITIVE_DATABASE_URL もそろえて/,
    );
  });
});

describe("SSO の入口の設定", () => {
  it("API がコードを交換する先の差し替えは手元とテストだけ。本物の入口は https", () => {
    const internal = { ...cognito, COGNITO_OAUTH_INTERNAL_URL: "http://fake-cognito:9231" };
    expect(() => loadConfig({ ...base, ...internal, APP_ENV: "stg" })).toThrow(
      /COGNITO_OAUTH_INTERNAL_URL/,
    );
    const plainOauth = { ...cognito, COGNITO_OAUTH_URL: "http://auth.example.com" };
    expect(() => loadConfig({ ...base, ...plainOauth, APP_ENV: "stg" })).toThrow(
      /COGNITO_OAUTH_URL は https/,
    );
  });
});
