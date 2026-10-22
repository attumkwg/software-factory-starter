import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createWebLogger } from "./logger.ts";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { logger: createWebLogger({ level: "info", destination: stream }), lines };
}

describe("画面のサーバーのログ", () => {
  it("SSR の失敗の文の値(メールアドレス・引用符の中)を伏せる", () => {
    const { logger, lines } = capture();
    logger.error(
      { err: new Error('Cannot render "テスト太郎" for taro@example.com') },
      "SSR で失敗",
    );
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain("テスト太郎");
    expect(text).not.toContain("taro@example.com");
    expect(lines[0]).toMatchObject({ service: "web", level: "error", err: { type: "Error" } });
  });

  it("アクセスログのパスに入った値と、知らない項目を伏せる", () => {
    const { logger, lines } = capture();
    logger.info({ path: "/projects/テスト太郎", status: 404, cookie: "sid=abc" }, "request");
    expect(lines[0]).toMatchObject({ path: "/projects/[…]", status: 404, cookie: "[REDACTED]" });
  });
});
