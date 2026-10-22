import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, REDACTED } from "./index.ts";

function capture(opts: Partial<Parameters<typeof createLogger>[0]> = {}) {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  const logger = createLogger({ service: "test", level: "info", destination: stream, ...opts });
  return { logger, lines };
}

describe("createLogger", () => {
  it("知らない項目は伏せ、mixin の項目も同じ決まりを通る", () => {
    const { logger, lines } = capture({ mixin: () => ({ requestId: "req-12345678", user: "x" }) });
    logger.info({ taskId: "t-1", name: "テスト太郎" }, "作った");
    expect(lines[0]).toMatchObject({
      service: "test",
      level: "info",
      message: "作った",
      requestId: "req-12345678",
      user: REDACTED,
      taskId: "t-1",
      name: REDACTED,
    });
  });

  it("失敗は値を伏せた形で出す(SMTP の宛先・原因の中も)", () => {
    const { logger, lines } = capture();
    const err = new Error("550 <taro@example.com>: Recipient rejected", {
      cause: new Error('invalid input syntax: "テスト太郎"'),
    });
    logger.error({ err }, "送れなかった");
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain("taro@example.com");
    expect(text).not.toContain("テスト太郎");
    expect(lines[0]?.err).toMatchObject({
      type: "Error",
      message: "550 <[email]>: Recipient rejected",
    });
  });

  it("ログの文に値を入れても、伏せ字を通る", () => {
    const { logger, lines } = capture();
    logger.info(`宛先 taro@example.com に 09000000000`);
    expect(lines[0]?.message).toBe("宛先 [email] に [数字]");
  });
});
