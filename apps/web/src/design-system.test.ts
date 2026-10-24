import { describe, expect, it } from "vitest";
import { designSystemVisible } from "./design-system.ts";

describe("部品の一覧ページを出すか", () => {
  it("本番(prod)では出さない", () => {
    expect(designSystemVisible("prod")).toBe(false);
  });

  it.each([undefined, "local", "test", "preview", "stg"])("%s では出す", (appEnv) => {
    expect(designSystemVisible(appEnv)).toBe(true);
  });
});
