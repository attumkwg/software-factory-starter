import type { ERROR_CODES } from "@app/shared";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./api.ts";
import { handleFailure } from "./use-action.ts";

const httpError = (status: number, code: (typeof ERROR_CODES)[number]) =>
  new HttpError(status, { error: { code, message: "API の文", requestId: "req-1" } });

function fakeRouter() {
  return {
    clearCache: vi.fn(),
    navigate: vi.fn(async () => {}),
    invalidate: vi.fn(async () => {}),
  };
}

describe("書き込みの失敗の受け止め(useAction)", () => {
  it("401 はログイン画面へ回し、文は出さない", async () => {
    const router = fakeRouter();
    const show = vi.fn();
    await handleFailure(httpError(401, "unauthorized"), router as never, show);
    expect(router.clearCache).toHaveBeenCalledOnce();
    expect(router.navigate).toHaveBeenCalledWith({ to: "/login" });
    expect(router.invalidate).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it("読み直せば直るもの(404・409)は読み直してから文を出す", async () => {
    const router = fakeRouter();
    const show = vi.fn();
    await handleFailure(httpError(409, "conflict"), router as never, show);
    expect(router.invalidate).toHaveBeenCalledOnce();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ shouldReload: true }));
  });

  it("それ以外は読み直さずに文だけ出す", async () => {
    const router = fakeRouter();
    const show = vi.fn();
    await handleFailure(new Error("想定外"), router as never, show);
    expect(router.invalidate).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ shouldReload: false }));
  });
});
