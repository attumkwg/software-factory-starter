import { z } from "zod";

/** 組織の中のロール。強い順。 */
export const ROLES = ["admin", "member", "viewer"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;
