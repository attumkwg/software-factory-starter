import { describe, expect, it } from "vitest";
import {
  CreateProjectSchema,
  CreateTaskSchema,
  safeReturnTo,
  UpdateTaskSchema,
} from "./schemas.ts";

describe("CreateProjectSchema", () => {
  it("前後の空白を落とし、空の名前は通さない", () => {
    expect(CreateProjectSchema.parse({ name: "  計画  " })).toEqual({ name: "計画" });
    expect(CreateProjectSchema.safeParse({ name: "   " }).success).toBe(false);
  });
});

describe("名前・題名の NUL(文字の0番)", () => {
  it("通さない(DB が持てない)。ほかの変わった文字は通す", () => {
    expect(CreateProjectSchema.safeParse({ name: "a\u0000b" }).success).toBe(false);
    expect(CreateTaskSchema.safeParse({ title: "\u0000" }).success).toBe(false);
    expect(UpdateTaskSchema.safeParse({ title: "a\u0000" }).success).toBe(false);
    expect(CreateTaskSchema.safeParse({ title: "¶\u0092😀" }).success).toBe(true);
  });
});

describe("UpdateTaskSchema", () => {
  it("何も変えない更新は通さない", () => {
    expect(UpdateTaskSchema.safeParse({}).success).toBe(false);
    expect(UpdateTaskSchema.safeParse({ done: true }).success).toBe(true);
  });
});

describe("safeReturnTo(ログインの後に戻る先)", () => {
  it.each(["/", "/projects/0190", "/projects/0190?filter=open"])(
    "アプリの中のパス %s は、そのまま",
    (path) => {
      expect(safeReturnTo(path)).toBe(path);
    },
  );

  it.each([
    ["よそのサイト", "https://evil.example/"],
    ["スキームを省いたよそのサイト", "//evil.example/"],
    ["ブラウザが / と読む \\", "/\\evil.example"],
    ["途中の \\", "/projects\\..\\x"],
    ["javascript:", "javascript:alert(1)"],
    ["API", "/api/projects"],
    ["ログイン画面(行ったり来たり)", "/login?error=login_failed"],
    ["改行", "/projects\r\nSet-Cookie: x=1"],
    ["長すぎる", `/${"a".repeat(600)}`],
    ["文字列でない", 42],
    ["空", ""],
  ])("%s は / にする", (_, value) => {
    expect(safeReturnTo(value)).toBe("/");
  });
});
