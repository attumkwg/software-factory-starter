import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { can, ruleFor, toOpenApiPath } from "../../src/authz/policy.ts";
import { loadConfig } from "../../src/config.ts";
import type { RootDb } from "../../src/db/client.ts";
import { createLogger } from "../../src/logger.ts";

function appWithoutDb() {
  const config = loadConfig({
    APP_ENV: "test",
    DATABASE_URL: "postgres://unused",
    SESSION_SECRET: "x".repeat(32),
  });
  return createApp({ config, db: {} as RootDb, logger: createLogger({ level: "silent" }) });
}

describe("既定は拒否", () => {
  it("決まり(ROUTE_RULES)の無い API は、ハンドラーまで届かずに 403", async () => {
    const app = appWithoutDb();
    let reached = false;
    app.get("/api/secret", (c) => {
      reached = true;
      return c.text("secret");
    });
    const res = await app.request("/api/secret");
    expect(res.status).toBe(403);
    expect(reached).toBe(false);
  });

  it("ログインが要る API は、セッションが無ければ DB に触る前に 401", async () => {
    const res = await appWithoutDb().request("/api/projects");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; requestId?: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it("どの API にも当たらなければ 404", async () => {
    const res = await appWithoutDb().request("/api/nope");
    expect(res.status).toBe(404);
  });
});

describe("policy", () => {
  it("ロールごとの権限", () => {
    expect(can("admin", "project:delete")).toBe(true);
    expect(can("member", "project:delete")).toBe(false);
    expect(can("viewer", "task:write")).toBe(false);
    expect(can("viewer", "task:read")).toBe(true);
  });

  it("Hono のパスを OpenAPI の形にそろえて引く", () => {
    expect(toOpenApiPath("/api/projects/:projectId/tasks")).toBe("/api/projects/{projectId}/tasks");
    expect(ruleFor("delete", "/api/projects/{projectId}")).toBe("project:delete");
    expect(ruleFor("GET", "/api/unknown")).toBeUndefined();
  });
});

describe("API は画面を配らない(画面は apps/web のサービス)", () => {
  it("/api の外は 404(index.html を返さない)", async () => {
    const res = await appWithoutDb().request("/projects/abc");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("ログインが要る API は 401 のまま", async () => {
    expect((await appWithoutDb().request("/api/me")).status).toBe(401);
  });
});
