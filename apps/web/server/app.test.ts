import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createWebApp, type SsrHandler } from "./app.ts";

function setup(ssr: SsrHandler = () => new Response("<html></html>")) {
  const clientDir = mkdtempSync(join(tmpdir(), "web-client-"));
  mkdirSync(join(clientDir, "assets"));
  writeFileSync(join(clientDir, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(clientDir, "assets", "app-abc123.js.br"), "br-bytes");
  writeFileSync(join(clientDir, "assets", "app-abc123.js.gz"), "gz-bytes");
  const lifecycle = { shuttingDown: false };
  const app = createWebApp({ ssr, clientDir, logger: pino({ level: "silent" }), lifecycle });
  return { app, lifecycle };
}

describe("画面のサーバー", () => {
  it("止めている間は /readyz が 503(ALB に外してもらう)", async () => {
    const { app, lifecycle } = setup();
    expect((await app.request("/readyz")).status).toBe(200);
    lifecycle.shuttingDown = true;
    expect((await app.request("/readyz")).status).toBe(503);
    expect((await app.request("/healthz")).status).toBe(200);
  });

  it("ビルド済みの JS は1年キャッシュ", async () => {
    const { app } = setup();
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("ビルドのときに圧縮しておいた JS を、ブラウザが受け取れる方で返す(ALB は圧縮しない)", async () => {
    const { app } = setup();
    const br = await app.request("/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip, br" },
    });
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("content-type")).toContain("javascript");
    expect(br.headers.get("vary")).toContain("Accept-Encoding");
    expect(await br.text()).toBe("br-bytes");
    const gz = await app.request("/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip" },
    });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    const plain = await app.request("/assets/app-abc123.js");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe("console.log(1)");
  });

  it("SSR の HTML はその場で圧縮する", async () => {
    const { app } = setup(
      () => new Response("<p>x</p>".repeat(500), { headers: { "content-type": "text/html" } }),
    );
    const res = await app.request("/", { headers: { "accept-encoding": "br" } });
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("守りのヘッダー: HSTS は1年・使わない機能は Permissions-Policy で止める", async () => {
    const { app } = setup();
    const res = await app.request("/");
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    const policy = res.headers.get("permissions-policy") ?? "";
    expect(policy).toContain("camera=()");
    expect(policy).toContain("geolocation=()");
    expect(policy).toContain("microphone=()");
  });

  it("SSR の HTML は残させない(no-store)。画面の側で決めたものと、ビルド済みの JS はそのまま", async () => {
    const { app } = setup();
    expect((await app.request("/projects")).headers.get("cache-control")).toBe("no-store");
    const redirect = setup(() => Response.redirect("http://web/login", 302)).app;
    const r = await redirect.request("/projects");
    expect(r.status).toBe(302);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const own = setup(
      () => new Response("ok", { headers: { "cache-control": "public, max-age=60" } }),
    ).app;
    expect((await own.request("/about")).headers.get("cache-control")).toBe("public, max-age=60");
    expect((await app.request("/assets/app-abc123.js")).headers.get("cache-control")).toContain(
      "immutable",
    );
  });

  it("SSR に request ID を渡し、応答にも付ける(上から来た ID は引き継ぐ)", async () => {
    let seen: string | null = null;
    const { app } = setup((req) => {
      seen = req.headers.get("x-request-id");
      return new Response("ok");
    });
    const res = await app.request("/projects/1", { headers: { "x-request-id": "abcdef12-3456" } });
    expect(seen).toBe("abcdef12-3456");
    expect(res.headers.get("x-request-id")).toBe("abcdef12-3456");
  });

  it("書き込み(POST など)は受けない。書き込みはブラウザから API へ", async () => {
    let called = false;
    const { app } = setup(() => {
      called = true;
      return new Response("ok");
    });
    const res = await app.request("/", { method: "POST", body: "x" });
    expect(res.status).toBe(405);
    expect(called).toBe(false);
  });

  it("SSR が投げても、中身を出さずに 500", async () => {
    const { app } = setup(() => {
      throw new Error("db password is hunter2");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hunter2");
  });
});
