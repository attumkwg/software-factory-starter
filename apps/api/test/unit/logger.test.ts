import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/logger.ts";
import { contextFromHeaders, runWithRequestContext } from "../../src/request-context.ts";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { logger: createLogger({ level: "info", destination: stream }), lines };
}

describe("ログ", () => {
  it("全行に requestId / tenantId / traceId が入る", () => {
    const { logger, lines } = capture();
    runWithRequestContext(
      { requestId: "req-12345678", traceId: "t".repeat(32), tenantId: "tenant-a" },
      () => {
        logger.info({ projectId: "p1" }, "作った");
      },
    );
    logger.info("文脈の外");
    expect(lines[0]).toMatchObject({
      level: "info",
      message: "作った",
      requestId: "req-12345678",
      tenantId: "tenant-a",
      traceId: "t".repeat(32),
      projectId: "p1",
    });
    expect(lines[1]).toMatchObject({ requestId: null, tenantId: null, traceId: null });
  });

  it("メールやトークンは伏せる", () => {
    const { logger, lines } = capture();
    logger.info({ user: { email: "a@example.com" }, token: "secret" }, "x");
    expect(JSON.stringify(lines[0])).not.toContain("a@example.com");
    expect(JSON.stringify(lines[0])).not.toContain("secret");
  });
});

describe("request ID と trace ID", () => {
  it("W3C の traceparent を引き継ぐ", () => {
    const headers: Record<string, string> = {
      "x-request-id": "abcdef12-3456",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    };
    const ctx = contextFromHeaders((n) => headers[n]);
    expect(ctx.requestId).toBe("abcdef12-3456");
    expect(ctx.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("ALB の X-Amzn-Trace-Id を引き継ぐ", () => {
    const headers: Record<string, string> = {
      "x-amzn-trace-id": "Root=1-67891233-abcdef012345678912345678",
    };
    expect(contextFromHeaders((n) => headers[n]).traceId).toBe("67891233abcdef012345678912345678");
  });

  it("形の変な request ID は捨てて作り直す(ログの汚染を防ぐ)", () => {
    const headers: Record<string, string> = { "x-request-id": "bad id\n{json}" };
    expect(contextFromHeaders((n) => headers[n]).requestId).toMatch(/^[\da-f-]{36}$/);
  });
});
