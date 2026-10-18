import { ERROR_CODES } from "@app/shared";
import { describe, expect, it } from "vitest";
import { HttpError, NetworkError } from "./api.ts";
import { describeError, errorText } from "./errors.ts";

const httpError = (status: number, code: (typeof ERROR_CODES)[number], requestId = "req-1") =>
  new HttpError(status, { error: { code, message: "API の文(英語のこともある)", requestId } });

describe("失敗を利用者向けの文に直す", () => {
  it("API の message はそのまま出さない(code で決めた文にする)", () => {
    for (const code of ERROR_CODES) {
      expect(describeError(httpError(400, code)).message).not.toContain("API の文");
    }
  });

  it("読み直せば直るもの(消された・ぶつかった・権限が変わった)は読み直す", () => {
    expect(describeError(httpError(404, "not_found")).shouldReload).toBe(true);
    expect(describeError(httpError(409, "conflict")).shouldReload).toBe(true);
    expect(describeError(httpError(403, "forbidden")).shouldReload).toBe(true);
    expect(describeError(httpError(503, "service_unavailable")).shouldReload).toBe(false);
  });

  it("問い合わせ番号を付ける", () => {
    expect(errorText(describeError(httpError(500, "internal", "abc-123")))).toContain(
      "問い合わせ番号: abc-123",
    );
  });

  it("届かない・時間切れ・本文の無い 502(ALB)・想定外の値も文になる", () => {
    expect(describeError(new NetworkError("unreachable", "browser")).message).toContain(
      "通信できません",
    );
    expect(describeError(new NetworkError("timeout", "browser")).message).toContain("時間内");
    // SSR から API に届かないのは利用者の通信のせいではない
    expect(describeError(new NetworkError("unreachable", "server")).message).toContain(
      "止まっています",
    );
    expect(describeError(new HttpError(502, null)).message).toContain("うまくいきません");
    expect(describeError("文字列").message).toContain("うまくいきません");
  });
});
