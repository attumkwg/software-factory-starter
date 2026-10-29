import { describe, expect, it } from "vitest";
import { HttpError, NetworkError } from "./api-errors.ts";
import { isRefusal } from "./ssr-status.ts";

// 受け皿が応答の番号を写すのは、API の断りが届いたときだけ(#186)。
// 画面のバグ・通信の失敗・API の 5xx は写さない(本物の失敗は 500 のまま。アラームと自動の戻しに使う)
describe("受け皿に届いた失敗が API の断りか", () => {
  const http = (status: number) => new HttpError(status, null);

  it("400・401・403・404 は断り", () => {
    for (const s of [400, 401, 403, 404]) expect(isRefusal(http(s))).toBe(true);
  });

  it("API の 5xx・409・通信の失敗・画面のバグは断りでない", () => {
    expect(isRefusal(http(500))).toBe(false);
    expect(isRefusal(http(502))).toBe(false);
    expect(isRefusal(http(409))).toBe(false);
    expect(isRefusal(new NetworkError("timeout", "server"))).toBe(false);
    expect(isRefusal(new TypeError("undefined is not a function"))).toBe(false);
  });
});
