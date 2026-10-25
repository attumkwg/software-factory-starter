import { describe, expect, it } from "vitest";
import {
  idOfLinkToken,
  linkKey,
  makeLinkToken,
  verifyLinkToken,
} from "../../src/domains/growth/links.ts";

// 事前登録の確認・取り消しのリンク(設計書 0025 の 3)。token は「登録の ID.署名」。DB に持たない。

const key = linkKey("x".repeat(40));
const id = "01900000-0000-7000-8000-000000000001";
const at = new Date("2026-10-25T00:00:00.000Z");

describe("リンクの token", () => {
  it("同じ用途・ID・時刻なら同じ token(アウトボックスが2回届けても同じリンク)", () => {
    expect(makeLinkToken(key, "confirm", id, at)).toBe(makeLinkToken(key, "confirm", id, at));
    expect(idOfLinkToken(makeLinkToken(key, "confirm", id, at))).toBe(id);
  });

  it("用途・時刻・鍵が違えば通らない", () => {
    const token = makeLinkToken(key, "confirm", id, at);
    expect(verifyLinkToken(key, "confirm", token, id, at)).toBe(true);
    expect(verifyLinkToken(key, "withdraw", token, id, at)).toBe(false);
    expect(verifyLinkToken(key, "confirm", token, id, new Date(at.getTime() + 1))).toBe(false);
    expect(verifyLinkToken(linkKey("y".repeat(40)), "confirm", token, id, at)).toBe(false);
  });

  it("形の違う token は ID を返さない", () => {
    expect(idOfLinkToken("not-a-token")).toBeNull();
    expect(idOfLinkToken(`${id}.a.b`)).toBeNull();
    expect(idOfLinkToken("1234.abc")).toBeNull();
  });

  it("セッションの秘密そのものを鍵に使わない", () => {
    expect(linkKey("x".repeat(40)).toString()).not.toBe("x".repeat(40));
  });
});
