import { afterAll, describe, expect, inject, it } from "vitest";
import { createTestApp } from "../helpers/fixtures.ts";

const { app, pool, lifecycle } = createTestApp(inject("appUrl"));
afterAll(() => pool.end());

describe("ヘルスチェック", () => {
  it("/healthz は生きていれば 200、request ID を返す", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toEqual(expect.any(String));
  });

  it("/readyz は DB に届けば 200、止める途中なら 503(ALB に送るのをやめてもらう)", async () => {
    expect((await app.request("/readyz")).status).toBe(200);
    lifecycle.shuttingDown = true;
    expect((await app.request("/readyz")).status).toBe(503);
    lifecycle.shuttingDown = false;
  });
});
