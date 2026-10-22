import { describe, expect, it } from "vitest";
import { isAllowedKey, REDACTED, sanitizeFields, scrubPath } from "./fields.ts";

const ID = "0192f3a4-1234-7abc-8def-0123456789ab";

describe("許可リスト", () => {
  it("…Id と決めた名前だけ出す。知らない名前は値を伏せる", () => {
    expect(
      sanitizeFields({
        taskId: ID,
        status: 200,
        durationMs: 12,
        title: "病名テスト",
        body: { a: 1 },
      }),
    ).toEqual({ taskId: ID, status: 200, durationMs: 12, title: REDACTED, body: REDACTED });
  });

  it("伏せる名前は、大文字・小文字と _ を問わず、許可リストより強い", () => {
    expect(isAllowedKey("staffName")).toBe(false);
    expect(isAllowedKey("staff_name")).toBe(false);
    expect(isAllowedKey("newEmail")).toBe(false);
    expect(isAllowedKey("requestId")).toBe(true);
    expect(isAllowedKey("eventTenantId")).toBe(true);
    expect(isAllowedKey("taskIds")).toBe(true);
    expect(isAllowedKey("Id")).toBe(false);
    expect(isAllowedKey("user_id")).toBe(false);
  });

  it("深い所も同じ決まりで絞る", () => {
    expect(sanitizeFields({ counts: { projectId: ID, name: "テスト太郎" } })).toEqual({
      counts: REDACTED,
    });
    expect(sanitizeFields({ route: "x", taskIds: [ID, "テスト太郎"] })).toEqual({
      route: "x",
      taskIds: [ID, REDACTED],
    });
  });

  it("ID の名前でも、ID の形でない値(メールアドレス・日本語)は伏せる", () => {
    expect(sanitizeFields({ userId: "taro@example.com", tenantId: "テスト" })).toEqual({
      userId: REDACTED,
      tenantId: REDACTED,
    });
    expect(sanitizeFields({ messageId: `<task-completed.${ID}@app.example.com>` })).toEqual({
      messageId: `<task-completed.${ID}@app.example.com>`,
    });
  });

  it("出してよい名前の文字列も伏せ字を通す", () => {
    expect(sanitizeFields({ reason: "550 <taro@example.com> 09000000000" })).toEqual({
      reason: "550 <[email]> [数字]",
    });
  });

  it("数・真偽・null はそのまま", () => {
    expect(sanitizeFields({ count: 0, hasVerifiedEmail: false, code: null })).toEqual({
      count: 0,
      hasVerifiedEmail: false,
      code: null,
    });
  });
});

describe("パス", () => {
  it("ID と英字の名前だけ残す", () => {
    expect(scrubPath(`/api/projects/${ID}/tasks`)).toBe(`/api/projects/${ID}/tasks`);
    expect(scrubPath("/api/projects/テスト太郎")).toBe("/api/projects/[…]");
    expect(scrubPath("/api/090-0000-0000")).toBe("/api/[…]");
    expect(scrubPath("/api/taro@example.com")).toBe("/api/[…]");
  });
});
