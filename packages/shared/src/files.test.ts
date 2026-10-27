import { describe, expect, it } from "vitest";
import { CreateFileSchema, FILE_LIMITS, safeFileName } from "./files.ts";

describe("CreateFileSchema(上げると言う物)", () => {
  const ok = { name: "現場.jpg", contentType: "image/jpeg", byteSize: 1024 };

  it("決めた種類と大きさなら通す", () => {
    expect(CreateFileSchema.safeParse(ok).success).toBe(true);
    expect(CreateFileSchema.safeParse({ ...ok, byteSize: FILE_LIMITS.maxBytes }).success).toBe(
      true,
    );
  });

  it.each(["image/svg+xml", "text/html", "image/heic", "application/octet-stream"])(
    "種類 %s は通さない",
    (contentType) => {
      expect(CreateFileSchema.safeParse({ ...ok, contentType }).success).toBe(false);
    },
  );

  it("0 バイト・上限を超える大きさ・小数は通さない", () => {
    for (const byteSize of [0, FILE_LIMITS.maxBytes + 1, 1.5]) {
      expect(CreateFileSchema.safeParse({ ...ok, byteSize }).success).toBe(false);
    }
  });

  it("空の名前・長すぎる名前は通さない", () => {
    expect(CreateFileSchema.safeParse({ ...ok, name: "  " }).success).toBe(false);
    expect(CreateFileSchema.safeParse({ ...ok, name: "あ".repeat(201) }).success).toBe(false);
  });
});

describe("safeFileName", () => {
  it("道の区切りと制御文字を _ にする", () => {
    expect(safeFileName("../a/b\\c\n.jpg")).toBe(".._a_b_c_.jpg");
    expect(safeFileName("現場 1.jpg")).toBe("現場 1.jpg");
  });
});
