import { describe, expect, it, vi } from "vitest";

// SSR の失敗をブラウザへ渡すときに、中身が漏れないこと。
// (ログに残す部分はサーバーの文脈が要るので、ここでは置き換える)
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/", { headers: { "x-request-id": "t-1" } }),
}));

const { hiddenErrorAdapter } = await import("./start.ts");
const { HttpError, NetworkError } = await import("./api.ts");
const { setReportError } = await import("./report-hook.ts");

describe("SSR の失敗をブラウザへ渡す形", () => {
  it("想定外の失敗は、中身を捨てて渡す(元の失敗はサーバーのログにだけ残す)", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const secret = new Error("db password=hunter2 at /srv/app/internal.ts");
    expect(hiddenErrorAdapter.test(secret)).toBe(true);
    const sent = JSON.stringify(hiddenErrorAdapter.toSerializable(secret));
    expect(sent).not.toContain("hunter2");
    expect(sent).not.toContain("internal.ts");
    expect(hiddenErrorAdapter.fromSerializable({}).message).toBe("想定外の失敗");
    expect(String(write.mock.calls[0]?.[0])).toContain("hunter2");
    write.mockRestore();
  });

  it("想定外の失敗は、ログと同じ行で Sentry の入口にも渡す(ブラウザ側では送らない形に戻す)", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const reported: Record<string, unknown>[] = [];
    setReportError((line) => reported.push(line));
    hiddenErrorAdapter.toSerializable(new TypeError("boom"));
    expect(reported).toEqual([
      expect.objectContaining({
        level: "error",
        requestId: "t-1",
        err: expect.objectContaining({ type: "TypeError" }),
      }),
    ]);
    expect(hiddenErrorAdapter.fromSerializable({}).name).toBe("ServerReportedError");
    setReportError(undefined);
    write.mockRestore();
  });

  it("自分たちの失敗(code と問い合わせ番号だけを持つ)は、この変換を通らない", () => {
    expect(hiddenErrorAdapter.test(new HttpError(500, null))).toBe(false);
    expect(hiddenErrorAdapter.test(new NetworkError("timeout", "server"))).toBe(false);
  });
});
