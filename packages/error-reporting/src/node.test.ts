import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it } from "vitest";
import { createErrorReporter } from "./node.ts";

// 本物の Sentry には送らず、送るはずだった中身(envelope)を受け取る
function capture() {
  const events: Record<string, unknown>[] = [];
  const transport: Sentry.NodeOptions["transport"] = (opts) =>
    Sentry.createTransport(opts, async (req) => {
      const lines = String(req.body).split("\n");
      for (let i = 1; i < lines.length; i += 2) {
        if (lines[i]?.includes('"type":"event"')) events.push(JSON.parse(lines[i + 1] ?? "{}"));
      }
      return { statusCode: 200 };
    });
  return { events, transport };
}

afterEach(async () => {
  await Sentry.close(1000);
});

describe("サーバーの失敗を Sentry に送る", () => {
  it("DSN が無ければ何もしない", () => {
    expect(
      createErrorReporter({ dsn: undefined, environment: "local", service: "api" }),
    ).toBeNull();
  });

  it("ログの error の行を、決めた項目だけで送る", async () => {
    const { events, transport } = capture();
    const reporter = createErrorReporter({
      dsn: "https://public@o1.ingest.sentry.io/1",
      environment: "test",
      service: "api",
      transport,
    });
    reporter?.stream.write(
      `${JSON.stringify({
        level: "error",
        message: "失敗しました",
        service: "api",
        requestId: "req-12345678",
        tenantId: "tenant-a",
        code: "internal",
        method: "POST",
        body: { title: "極秘" },
        err: {
          type: "TypeError",
          message: 'boom for "taro@example.com"',
          stack: "TypeError: boom\n    at handler (/app/dist/index.js:10:5)",
        },
      })}\n`,
    );
    reporter?.stream.write(`${JSON.stringify({ level: "info", message: "request" })}\n`);
    await reporter?.flush(1000);

    expect(events).toHaveLength(1);
    const event = events[0] as Record<string, unknown>;
    const json = JSON.stringify(event);
    expect(json).not.toContain("極秘");
    expect(json).not.toContain("taro@example.com");
    expect(event).toMatchObject({
      level: "error",
      environment: "test",
      server_name: "api",
      tags: { requestId: "req-12345678", tenantId: "tenant-a", code: "internal", service: "api" },
      exception: { values: [{ type: "TypeError" }] },
    });
    // 自動の仕組みは切ってある(リクエスト・パンくず・利用者)
    expect(event.request).toBeUndefined();
    expect(event.breadcrumbs ?? []).toEqual([]);
    expect(event.user).toBeUndefined();
  });

  it("同じ失敗が大量に出ても、1分に送る数を絞る", async () => {
    const { events, transport } = capture();
    const reporter = createErrorReporter({
      dsn: "https://public@o1.ingest.sentry.io/1",
      environment: "test",
      service: "api",
      transport,
    });
    for (let i = 0; i < 50; i++) {
      reporter?.report({
        level: "error",
        message: "DB に届きません",
        err: { type: "Error", message: "ECONNREFUSED" },
      });
    }
    await reporter?.flush(1000);
    expect(events).toHaveLength(3);
  });
});
