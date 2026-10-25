import { BlockList, isIP } from "node:net";
import type { Context } from "hono";
import type { AppEnv } from "../env.ts";

// いまの人の IP(組織ごとの IP の制限。docs/designs/0056-sso-scim-ip-audit-export.md の 6)。
// 中継(ALB・CloudFront)は X-Forwarded-For の**右端**に、見た相手の IP を足す。左側は呼ぶ側が好きに書けるので信じない。
// 前にいる中継の数(設定の TRUSTED_PROXY_HOPS。ALB だけなら 1)だけ右から数えた値を、いまの人の IP にする。
// 画面のサーバー(SSR)からの呼び出しは、画面のサーバーが受け取った X-Forwarded-For をそのまま引き継ぐ
// (apps/web/src/api.ts の FORWARDED_HEADERS)ので、数え方は同じ。
// API は ALB と画面のサーバーからしか呼ばれない(セキュリティグループ)ので、このヘッダーを信じてよい。

/** いまの人の IP。分からなければ null(制限のある組織では入れない) */
export function clientIp(c: Context<AppEnv>): string | null {
  return forwardedClientIp(c.req.header("x-forwarded-for"), c.get("trustedProxyHops"));
}

/** X-Forwarded-For の右から hops 個目。足りない・IP の形でなければ null */
export function forwardedClientIp(forwarded: string | undefined, hops: number): string | null {
  const entries = forwarded?.split(",").map((s) => s.trim()) ?? [];
  const value = entries[entries.length - hops];
  return value && isIP(value) ? value : null;
}

/** CIDR(203.0.113.0/24・2001:db8::/32)を読む。形が違えば null */
export function parseCidr(
  cidr: string,
): { address: string; prefix: number; family: "ipv4" | "ipv6" } | null {
  const [address = "", prefixText, ...rest] = cidr.trim().split("/");
  if (rest.length > 0 || prefixText === undefined || !/^\d{1,3}$/.test(prefixText)) return null;
  const version = isIP(address);
  const prefix = Number(prefixText);
  if (version === 4 && prefix <= 32) return { address, prefix, family: "ipv4" };
  if (version === 6 && prefix <= 128) return { address, prefix, family: "ipv6" };
  return null;
}

/** IP が、どれかの範囲に入っているか(範囲が空なら false。制限が無いかは呼ぶ側が決める) */
export function ipInRanges(ip: string, cidrs: readonly string[]): boolean {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const r = parseCidr(cidr);
    if (r) list.addSubnet(r.address, r.prefix, r.family);
  }
  const version = isIP(ip);
  if (version === 0) return false;
  return list.check(ip, version === 4 ? "ipv4" : "ipv6");
}
