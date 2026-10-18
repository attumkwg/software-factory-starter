import type { ErrorEvent } from "@sentry/browser";
import { describe, expect, it } from "vitest";
import { HttpError, NetworkError } from "./api.ts";
import { ServerReportedError, scrubEvent, shouldReport } from "./report-error.ts";

describe("ブラウザの失敗を Sentry に送る", () => {
  it("送るのはこちらのバグだけ(API・通信・SSR の失敗は送らない)", () => {
    expect(shouldReport(new TypeError("x is undefined"))).toBe(true);
    expect(shouldReport(new HttpError(500, null))).toBe(false);
    expect(shouldReport(new NetworkError("timeout", "browser"))).toBe(false);
    expect(shouldReport(new ServerReportedError())).toBe(false);
  });

  it("送る直前に、値になりうる物を落とす", () => {
    const event = scrubEvent({
      type: undefined,
      exception: {
        values: [{ type: "SyntaxError", value: `"taro@example.com" is not valid JSON` }],
      },
      request: {
        url: "https://app.example.com/projects/p1?q=極秘#x",
        headers: { cookie: "session=abc" },
      },
      user: { email: "taro@example.com" },
      breadcrumbs: [{ message: "clicked 極秘のタスク" }],
      extra: { title: "極秘" },
    } as ErrorEvent);
    const json = JSON.stringify(event);
    expect(json).not.toContain("taro@example.com");
    expect(json).not.toContain("極秘");
    expect(json).not.toContain("session=abc");
    expect(event.request).toEqual({ url: "https://app.example.com/projects/p1" });
  });
});
