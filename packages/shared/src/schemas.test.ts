import { describe, expect, it } from "vitest";
import { CreateProjectSchema, UpdateTaskSchema } from "./schemas.ts";

describe("CreateProjectSchema", () => {
  it("前後の空白を落とし、空の名前は通さない", () => {
    expect(CreateProjectSchema.parse({ name: "  計画  " })).toEqual({ name: "計画" });
    expect(CreateProjectSchema.safeParse({ name: "   " }).success).toBe(false);
  });
});

describe("UpdateTaskSchema", () => {
  it("何も変えない更新は通さない", () => {
    expect(UpdateTaskSchema.safeParse({}).success).toBe(false);
    expect(UpdateTaskSchema.safeParse({ done: true }).success).toBe(true);
  });
});
