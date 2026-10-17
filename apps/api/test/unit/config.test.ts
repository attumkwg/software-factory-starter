import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";

const base = { DATABASE_URL: "postgres://x", SESSION_SECRET: "s".repeat(32) };

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
    const prod = loadConfig({
      ...base,
      APP_ENV: "prod",
      AUTH_MODE: "cognito",
      COGNITO_REGION: "ap-northeast-1",
      COGNITO_USER_POOL_ID: "p",
      COGNITO_CLIENT_ID: "c",
    });
    expect(prod.session.secureCookie).toBe(true);
    expect(prod.exposeOpenApi).toBe(false);
    expect(loadConfig({ ...base, APP_ENV: "local" }).session.secureCookie).toBe(false);
  });

  it("短すぎるセッションの秘密は通さない", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });
});
