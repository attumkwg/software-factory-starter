import { Writable } from "node:stream";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb, type RootDb } from "../../src/db/client.ts";
import { ApiError, serializeError, toApiError } from "../../src/errors.ts";
import { createLogger } from "../../src/logger.ts";

/** pg の DatabaseError に似せた物(code と detail を持つ)。 */
function pgError(code: string, detail = "Key (email)=(taro@example.com) already exists.") {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code,
    detail,
    constraint: "users_email_key",
    table: "users",
  });
}

/** Drizzle が包んだ形(message とスタックに params が入る)。 */
const drizzleWrapped = (cause: unknown) =>
  new DrizzleQueryError(
    'insert into "tasks" ("title") values ($1)',
    ["見積もりを出す(秘密の案件名)"],
    cause as Error,
  );

describe("想定外の失敗を利用者に返す形に直す", () => {
  it.each([
    ["57P01", 503, "service_unavailable"], // DB の再起動・切り替え
    ["57014", 503, "service_unavailable"], // statement_timeout
    ["53300", 503, "service_unavailable"], // 接続の上限
    ["40001", 503, "service_unavailable"], // 直列化の失敗
    ["08006", 503, "service_unavailable"], // 接続の失敗(08 で始まるもの)
    ["ECONNREFUSED", 503, "service_unavailable"], // DB に届かない
    ["23503", 409, "conflict"], // 親が同時に消された
    ["23505", 409, "conflict"], // 一意の制約
    ["42P01", 500, "internal"], // 表が無い(こちらのバグ)
  ])("DB の %s は %i(%s)。Drizzle に包まれていても同じ", (code, status, apiCode) => {
    for (const err of [pgError(code), drizzleWrapped(pgError(code))]) {
      const mapped = toApiError(err);
      expect(mapped.status).toBe(status);
      expect(mapped.code).toBe(apiCode);
    }
  });

  it("接続が切れた(code の無い pg の失敗)は 503", () => {
    expect(toApiError(drizzleWrapped(new Error("Connection terminated unexpectedly"))).code).toBe(
      "service_unavailable",
    );
    expect(toApiError(new Error("timeout exceeded when trying to connect")).code).toBe(
      "service_unavailable",
    );
  });

  it("Hono の失敗は決まった code に", () => {
    expect(toApiError(new HTTPException(400, { message: "Malformed JSON" })).code).toBe(
      "bad_request",
    );
    expect(toApiError(new HTTPException(415)).code).toBe("unsupported_media_type");
    expect(toApiError(new HTTPException(403)).code).toBe("forbidden");
  });

  it("ApiError はそのまま・それ以外の想定外は 500", () => {
    const e = new ApiError(404, "not_found", "見つかりません");
    expect(toApiError(e)).toBe(e);
    expect(toApiError(new TypeError("x is undefined")).code).toBe("internal");
    expect(toApiError("文字列が投げられた").code).toBe("internal");
  });
});

describe("ログに値を残さない", () => {
  it("SQL のパラメータと DB の detail を落とし、code・制約・スタックは残す", () => {
    const out = JSON.stringify(serializeError(drizzleWrapped(pgError("23505"))));
    expect(out).not.toContain("秘密の案件名");
    expect(out).not.toContain("taro@example.com");
    expect(out).toContain("Failed query: insert into");
    expect(out).toContain("23505");
    expect(out).toContain("users_email_key");
    expect(out).toContain("at ");
  });

  it("logger.error({ err }) でも同じ(serializers.err を通る)", () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    createLogger({ level: "info", destination }).error(
      { err: drizzleWrapped(pgError("57P01")) },
      "失敗しました",
    );
    expect(lines.join("")).not.toContain("秘密の案件名");
    expect(lines.join("")).not.toContain("taro@example.com");
    expect(lines.join("")).toContain("57P01");
  });
});

describe("DB の接続が切れてもプロセスは落ちない", () => {
  it("使っていない接続の失敗(プールの error)は記録だけ", async () => {
    const seen: Error[] = [];
    const { pool } = createDb("postgres://unused@localhost:1/x", {
      onIdleError: (err) => seen.push(err),
    });
    // 聞く人がいなければ、ここで Node が例外を投げてプロセスが止まる
    expect(() =>
      pool.emit("error", new Error("terminating connection due to administrator command")),
    ).not.toThrow();
    expect(seen).toHaveLength(1);
    await pool.end();
  });
});

describe("本文の失敗は決まった code で返す", () => {
  function app() {
    const config = loadConfig({
      APP_ENV: "test",
      DATABASE_URL: "postgres://unused",
      SESSION_SECRET: "x".repeat(32),
    });
    return createApp({ config, db: {} as RootDb, logger: createLogger({ level: "silent" }) });
  }
  const post = (body: string, contentType = "application/json") =>
    app().request("/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });

  it("壊れた JSON は 400 bad_request", async () => {
    const res = await post("{");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_request");
  });

  it("JSON でない本文は 415 unsupported_media_type", async () => {
    const res = await post("{}", "application/xml");
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "unsupported_media_type",
    );
  });

  it("1MB を超える本文は 413 payload_too_large(読む前に断る)", async () => {
    const res = await post(JSON.stringify({ email: "a".repeat(1024 * 1024 + 1) }));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "payload_too_large",
    );
  });
});
