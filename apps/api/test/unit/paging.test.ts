import { describe, expect, it } from "vitest";
import { beyondCursor, decodeCursor, encodeCursor, toPage } from "../../src/db/paging.ts";
import { projects } from "../../src/db/schema.ts";

// 一覧のページングの続きの印(DB を使わない所だけ。DB を使う所は integration/performance.int.test.ts)

const cursor = { at: "2026-10-20T12:34:56.123456Z", id: "0192a5c4-1b2c-7d3e-8f40-123456789abc" };
const encode = (text: string) => Buffer.from(text).toString("base64url");

describe("続きの印", () => {
  it("作った印を読むと、元の時刻(マイクロ秒まで)と ID に戻る", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ["区切りが多い", `${cursor.at}|${cursor.id}|x`],
    ["時刻がミリ秒まで", `2026-10-20T12:34:56.123Z|${cursor.id}`],
    ["ありえない日(2月30日)", `2026-02-30T00:00:00.000000Z|${cursor.id}`],
    ["ありえない月(13月)", `2026-13-01T00:00:00.000000Z|${cursor.id}`],
    ["ID が UUID でない", `${cursor.at}|not-a-uuid`],
    ["空", ""],
  ])("壊れた印(%s)は 400", (_label, text) => {
    expect(() => decodeCursor(encode(text))).toThrow(
      expect.objectContaining({ status: 400 }) as Error,
    );
  });

  it("印が無ければ絞らない。あれば向きに合わせて絞る", () => {
    expect(beyondCursor(null, "asc", projects.createdAt, projects.id)).toBeUndefined();
    expect(beyondCursor(cursor, "asc", projects.createdAt, projects.id)).toBeDefined();
    expect(beyondCursor(cursor, "desc", projects.createdAt, projects.id)).toBeDefined();
  });

  it("limit より1件多く読めたときだけ、続きの印を付ける", () => {
    const rows = [1, 2, 3].map((n) => ({ ...cursor, id: `${n}` }));
    const more = toPage(rows, 2, (r) => r);
    expect(more.rows).toHaveLength(2);
    expect(more.nextCursor).toBe(encodeCursor({ at: cursor.at, id: "2" }));
    expect(toPage(rows, 3, (r) => r).nextCursor).toBeNull();
    expect(toPage([], 3, (r) => r)).toEqual({ rows: [], nextCursor: null });
  });
});
