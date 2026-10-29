import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { API_STATUS_HEADER } from "./api-status.ts";
import { createWebApp, type SsrHandler } from "./app.ts";

function setup(ssr: SsrHandler, logLines: Record<string, unknown>[] | null = null) {
  const app = createWebApp({
    ssr,
    clientDir: mkdtempSync(join(tmpdir(), "web-client-")),
    logger: logLines
      ? pino({ level: "info" }, { write: (line: string) => logLines.push(JSON.parse(line)) })
      : pino({ level: "silent" }),
    lifecycle: { shuttingDown: false },
  });
  return { app };
}

// #186: 権限の無い画面を直接開くと、画面には「権限がありません」が出るのに、応答は 500 だった
describe("API が断っただけの画面は、その番号で返す(#186)", () => {
  const ssrWith = (status: number, apiStatuses: string) => () =>
    new Response("<html>この操作の権限がありません</html>", {
      status,
      headers: { [API_STATUS_HEADER]: apiStatuses },
    });

  it("API の 403 だけで受け皿が出たら 403。内側のヘッダーは外す", async () => {
    const res = await setup(ssrWith(500, "403")).app.request("/settings");
    expect(res.status).toBe(403);
    expect(res.headers.has(API_STATUS_HEADER)).toBe(false);
    expect(await res.text()).toContain("権限がありません");
  });

  it("断りが2つ重なっても最初の番号(403, 403 → 403・404 → 404)", async () => {
    expect((await setup(ssrWith(500, "403, 403")).app.request("/audit")).status).toBe(403);
    expect((await setup(ssrWith(500, "404")).app.request("/x")).status).toBe(404);
  });

  it("API の 5xx・届かなかった(0)が混ざれば 500 のまま", async () => {
    expect((await setup(ssrWith(500, "403, 502")).app.request("/settings")).status).toBe(500);
    expect((await setup(ssrWith(500, "0")).app.request("/settings")).status).toBe(500);
  });

  it("画面が自分で受けた(200・404)なら番号は変えず、ヘッダーだけ外す", async () => {
    const ok = await setup(ssrWith(200, "404")).app.request("/projects/x");
    expect(ok.status).toBe(200);
    expect(ok.headers.has(API_STATUS_HEADER)).toBe(false);
  });

  it("400(URL の形が変)も断りとして写す", async () => {
    expect((await setup(ssrWith(500, "400")).app.request("/audit?before=x")).status).toBe(400);
  });

  it("外から来た依頼の内側のヘッダーは捨てる(SSR に渡さない・番号は変わらない)", async () => {
    let seen: string | null = "not called";
    const { app } = setup((req) => {
      seen = req.headers.get(API_STATUS_HEADER);
      return new Response("<html>壊れた</html>", { status: 500 });
    });
    const res = await app.request("/settings", { headers: { [API_STATUS_HEADER]: "403" } });
    expect(seen).toBeNull();
    expect(res.status).toBe(500);
  });

  it("書き換えたら、アクセスログの番号も書き換えた後(403)。元が 500 だったことを1行残す", async () => {
    const lines: Record<string, unknown>[] = [];
    const { app } = setup(ssrWith(500, "403"), lines);
    await app.request("/settings");
    expect(lines.find((l) => l.msg === "request")?.status).toBe(403);
    expect(lines.find((l) => l.msg === "API の断りの番号で返した")).toMatchObject({
      from: 500,
      to: 403,
    });
  });
});
