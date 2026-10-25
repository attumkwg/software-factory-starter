import { BlockList, isIP } from "node:net";
import type { Context } from "hono";
import type { AppEnv } from "../env.ts";

// いまの人の IP(組織ごとの IP の制限。docs/designs/0056-sso-scim-ip-audit-export.md の 6)。
// 読むヘッダーと段数は設定で決める(CLIENT_IP_HEADER・TRUSTED_PROXY_HOPS。設計書 0056 の U-9)。
// - 既定: ALB が X-Forwarded-For の**右端**に足す、見た相手の IP。左側は呼ぶ側が好きに書けるので信じない。
//   前にいる中継の数(TRUSTED_PROXY_HOPS)だけ右から数えた値を、いまの人の IP にする。
// - CloudFront を前に置いたら CloudFront-Viewer-Address(CloudFront が付ける「IP:ポート」)を読める。
// ヘッダーの名前を変えるだけでは、なりすましは止まらない。ALB が CloudFront からしか受けない形(送り元の一覧と
// CloudFront だけが知る秘密のヘッダー)と組で使う(設計書 0058)。
// 画面のサーバー(SSR)からの呼び出しは、画面のサーバーが受け取った同じヘッダーをそのまま引き継ぐ
// (apps/web/src/api.ts)ので、数え方は同じ。API は ALB と画面のサーバーからしか呼ばれない(セキュリティグループ)。

/** いまの人の IP。分からなければ null(制限のある組織では入れない) */
export function clientIp(c: Context<AppEnv>): string | null {
  const { header, hops } = c.get("clientIpSource");
  return forwardedClientIp(c.req.header(header), hops);
}

/** ヘッダーの値(カンマ区切り)の右から hops 個目。ポートが付いていれば外す。足りない・IP の形でなければ null */
export function forwardedClientIp(forwarded: string | undefined, hops: number): string | null {
  const entries = forwarded?.split(",").map((s) => s.trim()) ?? [];
  const value = entries[entries.length - hops];
  return value ? withoutPort(value) : null;
}

/** 「IP」「IPv4:ポート」「[IPv6]:ポート」「IPv6:ポート」(CloudFront-Viewer-Address)から IP だけを取る */
function withoutPort(value: string): string | null {
  if (isIP(value)) return value;
  const bracketed = /^\[([^\]]+)\]:\d{1,5}$/.exec(value);
  if (bracketed?.[1]) return isIP(bracketed[1]) ? bracketed[1] : null;
  const at = value.lastIndexOf(":");
  if (at <= 0 || !/^\d{1,5}$/.test(value.slice(at + 1))) return null;
  const host = value.slice(0, at);
  return isIP(host) ? host : null;
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
