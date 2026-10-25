import { z } from "zod";
import { RoleSchema } from "./roles.ts";
import { IdSchema } from "./schemas.ts";
import { InstantSchema } from "./time.ts";

// 大きなお客さん向けの守り(docs/specs/0056-sso-scim-ip-audit-export.md)の契約:
// 会社のドメイン・組織に入れる IP の範囲・組織の人の一覧(強制ログアウト)。

/** 会社のドメイン(小文字。example.co.jp の形。1つのドメインは1つの組織だけが確かめられる) */
export const DomainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/,
    "ドメインの形が正しくありません",
  );

export const OrganizationDomainSchema = z.object({
  id: IdSchema,
  domain: z.string(),
  /** DNS に置く TXT のレコード(名前と値)。確かめた後も見せる(消さないでもらうため) */
  verifyRecord: z.object({ name: z.string(), value: z.string() }),
  verifiedAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
});
export type OrganizationDomain = z.infer<typeof OrganizationDomainSchema>;

export const OrganizationDomainListSchema = z.object({
  domains: z.array(OrganizationDomainSchema),
});
export type OrganizationDomainList = z.infer<typeof OrganizationDomainListSchema>;

export const CreateDomainSchema = z.object({ domain: DomainNameSchema });
export type CreateDomain = z.infer<typeof CreateDomainSchema>;

/** 組織に入れる IP の範囲の上限 */
export const IP_ALLOWLIST_MAX = 20;

/** IP の範囲(CIDR。203.0.113.0/24・2001:db8::/32。1つの IP は /32・/128 を付ける) */
export const CidrSchema = z.string().trim().max(49);

export const IpAllowlistSchema = z.object({
  /** 空なら制限しない */
  cidrs: z.array(CidrSchema).max(IP_ALLOWLIST_MAX),
  /** いまの IP(画面が「自分を締め出さない」を見せるため) */
  yourIp: z.string().nullable().optional(),
});
export type IpAllowlist = z.infer<typeof IpAllowlistSchema>;

export const PutIpAllowlistSchema = z.object({
  cidrs: z.array(CidrSchema).max(IP_ALLOWLIST_MAX),
});
export type PutIpAllowlist = z.infer<typeof PutIpAllowlistSchema>;

/** 組織の人(管理者が見る一覧。強制ログアウトに使う) */
export const OrganizationMemberSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.email(),
  role: RoleSchema,
  createdAt: InstantSchema,
});
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;

export const OrganizationMemberPageSchema = z.object({
  members: z.array(OrganizationMemberSchema),
  nextCursor: z.string().nullable(),
});
export type OrganizationMemberPage = z.infer<typeof OrganizationMemberPageSchema>;
