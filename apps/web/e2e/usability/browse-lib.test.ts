// 初見の利用者テストの操作の道具の判定(仕様 0100)
import { describe, expect, it } from "vitest";
import { parseCommand, roleOf, type Step, sameOrigin, summarize } from "./browse-lib.ts";

const step = (action: string, ok = true, path = "/", error?: string): Step => ({
  at: "2026-11-14T00:00:00Z",
  action,
  args: ["ボタン", "足す"],
  ok,
  url: `http://localhost:8080${path}`,
  error,
});

describe("行き先", () => {
  it("同じアプリの中だけ通す", () => {
    expect(sameOrigin("http://localhost:8080", "/settings")).toBe("http://localhost:8080/settings");
    expect(sameOrigin("http://localhost:8080", "https://example.com/")).toBeNull();
    expect(sameOrigin("http://localhost:8080", "//example.com/x")).toBeNull();
  });
});

describe("記録のまとめ", () => {
  it("手数は操作だけを数え、見るだけは数えない。うまくいかなかった手と戻った数を出す", () => {
    const s = summarize([
      step("tap"),
      step("look"),
      step("fill", true, "/projects/1"),
      step("tap", false, "/projects/1", "見当たりません"),
      step("back", true, "/"),
    ]);
    expect(s.moves).toBe(4);
    expect(s.misses).toBe(1);
    expect(s.backs).toBe(1);
    expect(s.pages).toEqual(["/", "/projects/1"]);
    expect(s.missed).toEqual(["tap ボタン 足す: 見当たりません"]);
  });

  it("記録が空でも落ちない", () => {
    expect(summarize([]).moves).toBe(0);
  });
});

describe("呼び口", () => {
  it("操作と引数に分ける・役割は日本語でも言える", () => {
    expect(parseCommand(["tap", "ボタン", "足す"])).toEqual({
      action: "tap",
      args: ["ボタン", "足す"],
    });
    expect(parseCommand([])).toEqual({ action: "help", args: [] });
    expect(roleOf("ボタン")).toBe("button");
    expect(roleOf("チェック")).toBe("checkbox");
    expect(roleOf("link")).toBe("link");
  });
});
