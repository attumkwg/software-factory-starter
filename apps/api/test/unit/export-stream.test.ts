import { describe, expect, it, vi } from "vitest";
import { exportStream } from "../../src/export/stream.ts";
import type { Logger } from "../../src/logger.ts";

// 書き出しの流し方(docs/specs/0018-export-stream.md・ADR 0031)。DB の中身は結合テスト(export-stream.int.test.ts)。

const fakeLogger = () =>
  ({ error: vi.fn() }) as unknown as Logger & { error: ReturnType<typeof vi.fn> };

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("exportStream", () => {
  it("出てきた文字列を順につなげて流す", async () => {
    async function* chunks() {
      yield '{"a":[';
      yield "1,2";
      yield "]}";
    }
    expect(await readAll(exportStream(chunks(), fakeLogger()))).toBe('{"a":[1,2]}');
  });

  it("読みに来るまで次を作らない(関所のトランザクションが閉じる前に DB を読まない)", async () => {
    const made: number[] = [];
    async function* chunks() {
      for (let i = 0; i < 3; i++) {
        made.push(i);
        yield String(i);
      }
    }
    const reader = exportStream(chunks(), fakeLogger()).getReader();
    await new Promise((r) => setTimeout(r, 10));
    expect(made).toEqual([]);
    await reader.read();
    await new Promise((r) => setTimeout(r, 10));
    expect(made).toEqual([0]);
  });

  it("途中で失敗したら、ログに残して流れを切る(失敗の文は応答に出さない)", async () => {
    const logger = fakeLogger();
    const failure = new Error("connection terminated: taro@example.com");
    async function* chunks() {
      yield "{";
      throw failure;
    }
    const reader = exportStream(chunks(), logger).getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("{");
    await expect(reader.read()).rejects.toBe(failure);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith({ err: failure }, expect.any(String));
    // ログの文(固定の文)に、失敗の中身が混ざらない
    expect(logger.error.mock.calls[0]?.[1]).not.toContain("example.com");
  });

  it("受け手が切れば、残りは作らない", async () => {
    let finished = false;
    let made = 0;
    async function* chunks() {
      try {
        for (;;) {
          made += 1;
          yield "x";
        }
      } finally {
        finished = true;
      }
    }
    const reader = exportStream(chunks(), fakeLogger()).getReader();
    await reader.read();
    await reader.cancel();
    expect(finished).toBe(true);
    expect(made).toBe(1);
  });
});
