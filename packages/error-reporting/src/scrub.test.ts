import { describe, expect, it } from "vitest";
import { pickReportLine, scrubMessage } from "./scrub.ts";

describe("失敗の文から値を伏せる", () => {
  it.each([
    ["メールアドレス", "user taro@example.com not found", "taro@example.com"],
    ["key=value の値", "connect failed password=hunter2 host=db", "hunter2"],
    ["key: value の値", 'bad header authorization: "Bearer abc.def"', "abc.def"],
    ["URL の ? 以降", "GET https://api.example.com/x?token=abc123&q=secret failed", "secret"],
    ["JSON の中身", `Unexpected token 'a', "abc@x.co ..." is not valid JSON`, "abc@x.co"],
    ["引用符の中の文", 'duplicate value "Acme 社の極秘プロジェクト"', "極秘"],
    ["長い数字", "card 4111111111111111 declined", "4111111111111111"],
  ])("%s", (_label, input, secret) => {
    expect(scrubMessage(input)).not.toContain(secret);
  });

  it("手がかりになる短い名前は残す", () => {
    expect(scrubMessage("Cannot read properties of undefined (reading 'title')")).toBe(
      "Cannot read properties of undefined (reading 'title')",
    );
  });

  it("長すぎる文は切る", () => {
    expect(scrubMessage("x".repeat(1000)).length).toBeLessThanOrEqual(501);
  });
});

describe("ログの1行から送ってよい項目だけを拾う", () => {
  it("error 未満は送らない", () => {
    expect(pickReportLine({ level: "warn", message: "x" })).toBeNull();
    expect(pickReportLine({ level: "info", message: "x" })).toBeNull();
  });

  it("決めた項目だけを拾い、ほかの項目は捨てる", () => {
    const picked = pickReportLine({
      level: "error",
      message: "失敗しました",
      service: "api",
      requestId: "req-1",
      tenantId: "t-1",
      code: "internal",
      projectName: "極秘プロジェクト",
      user: { email: "a@example.com" },
      err: {
        type: "TypeError",
        message: "x",
        stack: "TypeError: x 秘密\n    at f (/app/a.js:1:2)",
      },
    });
    const json = JSON.stringify(picked);
    expect(json).not.toContain("極秘");
    expect(json).not.toContain("a@example.com");
    expect(picked?.err?.stack).toBe("    at f (/app/a.js:1:2)");
    expect(picked).toMatchObject({
      level: "error",
      requestId: "req-1",
      tenantId: "t-1",
      code: "internal",
    });
  });
});
