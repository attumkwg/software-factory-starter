import { describe, expect, it } from "vitest";
import { hasVerifyRecord } from "../../src/domains/organizations/security.ts";
import { forwardedClientIp, ipInRanges, parseCidr } from "../../src/http/client-ip.ts";

// 組織ごとの IP の制限の部品(docs/designs/0056-sso-scim-ip-audit-export.md の 6)。

describe("いまの人の IP(X-Forwarded-For の右から数える)", () => {
  it("中継が1つ(ALB だけ)なら右端。左に書いた値は信じない", () => {
    expect(forwardedClientIp("203.0.113.10", 1)).toBe("203.0.113.10");
    expect(forwardedClientIp("198.51.100.1, 203.0.113.10", 1)).toBe("203.0.113.10");
  });

  it("中継が2つ(CloudFront → ALB)なら右から2つ目", () => {
    expect(forwardedClientIp("1.2.3.4, 203.0.113.10, 130.176.0.1", 2)).toBe("203.0.113.10");
  });

  it("CloudFront-Viewer-Address(IP:ポート)は、ポートを外して読む", () => {
    expect(forwardedClientIp("203.0.113.10:46532", 1)).toBe("203.0.113.10");
    expect(forwardedClientIp("2001:db8::1:46532", 1)).toBe("2001:db8::1");
    expect(forwardedClientIp("[2001:db8::1]:443", 1)).toBe("2001:db8::1");
    expect(forwardedClientIp("2001:db8::1", 1)).toBe("2001:db8::1");
    expect(forwardedClientIp("example.com:443", 1)).toBeNull();
    expect(forwardedClientIp("[nope]:443", 1)).toBeNull();
    expect(forwardedClientIp("203.0.113.10:port", 1)).toBeNull();
  });

  it("足りない・無い・IP の形でなければ null", () => {
    expect(forwardedClientIp("203.0.113.10", 2)).toBeNull();
    expect(forwardedClientIp(undefined, 1)).toBeNull();
    expect(forwardedClientIp("unknown", 1)).toBeNull();
    expect(forwardedClientIp("203.0.113.10, ", 1)).toBeNull();
  });
});

describe("IP の範囲", () => {
  it("IPv4・IPv6 の CIDR を読む。形が違えば null", () => {
    expect(parseCidr("203.0.113.0/24")).toEqual({
      address: "203.0.113.0",
      prefix: 24,
      family: "ipv4",
    });
    expect(parseCidr("2001:db8::/32")?.family).toBe("ipv6");
    for (const bad of ["203.0.113.0", "203.0.113.0/33", "2001:db8::/129", "x/24", "1.2.3.4/2/3"]) {
      expect(parseCidr(bad), bad).toBeNull();
    }
  });

  it("どれかの範囲に入っていれば true。IPv4 と IPv6 は混ざらない", () => {
    const cidrs = ["203.0.113.0/24", "2001:db8::/32"];
    expect(ipInRanges("203.0.113.200", cidrs)).toBe(true);
    expect(ipInRanges("2001:db8:1::5", cidrs)).toBe(true);
    expect(ipInRanges("203.0.114.1", cidrs)).toBe(false);
    expect(ipInRanges("2001:db9::1", cidrs)).toBe(false);
    expect(ipInRanges("203.0.113.1", [])).toBe(false);
  });
});

describe("ドメインの確かめ", () => {
  const domain = {
    id: "0190a000-0000-7000-8000-000000000000",
    domain: "example.com",
    verifyRecord: { name: "_sfs-verify.example.com", value: "sfs-verify=abc" },
    verifiedAt: null,
    createdAt: "2026-10-25T00:00:00.000Z",
  };

  it("分かれて届いた TXT はつないで比べる。違う文字・空なら false", () => {
    expect(hasVerifyRecord([["sfs-verify=", "abc"]], domain)).toBe(true);
    expect(hasVerifyRecord([["other"], ["sfs-verify=abc"]], domain)).toBe(true);
    expect(hasVerifyRecord([["sfs-verify=abcd"]], domain)).toBe(false);
    expect(hasVerifyRecord([], domain)).toBe(false);
  });
});
