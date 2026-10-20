import { describe, expect, it } from "vitest";
import { sessionSetCookies, withCode } from "./api-parts.ts";
import { groupSecret } from "./pages/account/secret.ts";

describe("二段階認証の鍵の見せ方", () => {
  it("4文字ずつ空白で区切る", () => {
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(groupSecret("")).toBe("");
  });
});

describe("SSR でのセッションの Cookie の写し(ADR 0017)", () => {
  it("API が出し直したセッションの Cookie だけを選ぶ", () => {
    const headers = new Headers();
    headers.append("set-cookie", "sid=abc; Path=/; HttpOnly");
    headers.append("set-cookie", "__Host-sid=def; Path=/; Secure; HttpOnly");
    headers.append("set-cookie", "reauth=x; Path=/; HttpOnly");
    headers.append("set-cookie", "other=1");
    const picked = sessionSetCookies(new Response(null, { headers }));
    expect(picked.map((c) => c.split(";")[0])).toEqual(["sid=abc", "__Host-sid=def"]);
  });

  it("Set-Cookie が無ければ何も選ばない", () => {
    expect(sessionSetCookies(new Response(null))).toEqual([]);
  });
});

describe("二段階認証のコードを本文に入れるか", () => {
  it("コードがあるときだけ入れる", () => {
    expect(withCode({ password: "p" }, "123456")).toEqual({ password: "p", code: "123456" });
    expect(withCode({ password: "p" })).toEqual({ password: "p" });
    expect(withCode({ password: "p" }, "")).toEqual({ password: "p" });
  });
});
