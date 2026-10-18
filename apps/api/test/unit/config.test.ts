import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";

const base = { DATABASE_URL: "postgres://x", SESSION_SECRET: "s".repeat(32) };
const cognito = {
  AUTH_MODE: "cognito",
  COGNITO_REGION: "ap-northeast-1",
  COGNITO_USER_POOL_ID: "p",
  COGNITO_CLIENT_ID: "c",
  COGNITO_DOMAIN: "https://x.auth.ap-northeast-1.amazoncognito.com",
  APP_URL: "https://app.example.com",
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

  it("偽物の Cognito(発行元の差し替え)は手元とテストだけ", () => {
    const fake = { ...cognito, COGNITO_ISSUER: "http://fake-cognito.localhost:9231/p" };
    expect(() => loadConfig({ ...base, ...fake, APP_ENV: "stg" })).toThrow(/COGNITO_ISSUER/);
    expect(loadConfig({ ...base, ...fake, APP_ENV: "local" }).auth).toMatchObject({
      issuer: "http://fake-cognito.localhost:9231/p",
    });
  });

  it("stg と prod では、Cognito の入口と画面の URL は https だけ", () => {
    expect(() =>
      loadConfig({ ...base, ...cognito, APP_ENV: "stg", APP_URL: "http://app.example.com" }),
    ).toThrow(/APP_URL/);
    expect(() =>
      loadConfig({ ...base, ...cognito, APP_ENV: "prod", COGNITO_DOMAIN: "http://x.example" }),
    ).toThrow(/COGNITO_DOMAIN/);
  });

  it("スキャン用のログインは prod では起動しない", () => {
    expect(() =>
      loadConfig({ ...base, ...cognito, APP_ENV: "prod", COGNITO_SCAN_CLIENT_ID: "s" }),
    ).toThrow(/COGNITO_SCAN_CLIENT_ID/);
    expect(
      loadConfig({ ...base, ...cognito, APP_ENV: "stg", COGNITO_SCAN_CLIENT_ID: "s" }).auth,
    ).toMatchObject({ scanClientId: "s" });
  });

  it("短すぎるセッションの秘密は通さない", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });
});
