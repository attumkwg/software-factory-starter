import { z } from "@hono/zod-openapi";
import type { ScimFilter, ScimMember } from "../domains/organizations/index.ts";
import { ApiError } from "../errors.ts";

// SCIM 2.0(RFC 7643・7644)の形のうち、情シスの道具(Entra ID・Okta など)が Users に使う物だけ。
// DB は触らない(読み書きは src/domains/organizations/scim.ts)。docs/designs/0056-sso-scim-ip-audit-export.md の 3・6
//   - 人の ID はこちらの users の ID。userName はメールアドレス
//   - 名前は displayName → name.formatted → name.familyName と givenName の順で1つの名前にする
//   - メールの変更・ロール・グループは扱わない(メールの変更は 400、知らない項目は聞き流す)

export const SCIM_CORE_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";

/** 一覧の1ページの上限(SCIM の count) */
export const SCIM_PAGE_MAX = 100;

const NAME_MAX = 100;

/** SCIM の失敗(scimType つき)。本文は src/app.ts の onError が SCIM の Error の形にする */
export class ScimProblem extends ApiError {
  constructor(
    status: 400 | 409,
    readonly scimType: "invalidFilter" | "invalidValue" | "mutability" | "uniqueness",
    message: string,
  ) {
    super(status, status === 409 ? "already_member" : "bad_request", message);
  }
}

/** 400・409 で scimType を決めていない失敗の既定(領域の関数は SCIM を知らずに ApiError を投げる) */
const DEFAULT_SCIM_TYPE: Partial<Record<number, ScimProblem["scimType"]>> = {
  400: "invalidValue",
  409: "uniqueness",
};

/** SCIM の Error の本文(RFC 7644 の 3.12) */
export function scimErrorBody(e: ApiError) {
  const scimType = e instanceof ScimProblem ? e.scimType : DEFAULT_SCIM_TYPE[e.status];
  return {
    schemas: [SCIM_ERROR],
    status: String(e.status),
    ...(scimType ? { scimType } : {}),
    detail: e.message,
  };
}

// ── 入力 ──────────────────────────────────────────────────────────────────

/** Entra ID は真偽を "True" / "False" の文字で送ることがある */
const ScimBoolean = z
  .union([z.boolean(), z.enum(["True", "False", "true", "false"])])
  .transform((v) => (typeof v === "boolean" ? v : v.toLowerCase() === "true"));

const NameParts = z.looseObject({
  formatted: z
    .string()
    .max(NAME_MAX * 2)
    .optional(),
  familyName: z.string().max(NAME_MAX).optional(),
  givenName: z.string().max(NAME_MAX).optional(),
});

/** POST・PUT の本文(知らない項目は残して聞き流す) */
export const ScimUserInputSchema = z.looseObject({
  schemas: z.array(z.string()).optional(),
  userName: z.string().trim().min(1).max(254),
  externalId: z.string().max(255).nullable().optional(),
  displayName: z
    .string()
    .max(NAME_MAX * 2)
    .optional(),
  name: NameParts.optional(),
  emails: z
    .array(
      z.looseObject({
        value: z.string().max(254),
        primary: ScimBoolean.optional(),
        type: z.string().optional(),
      }),
    )
    .max(10)
    .optional(),
  active: ScimBoolean.optional(),
});
export type ScimUserInput = z.infer<typeof ScimUserInputSchema>;

export const ScimPatchSchema = z.looseObject({
  schemas: z.array(z.string()).optional(),
  Operations: z
    .array(
      z.looseObject({
        op: z.string().max(20),
        path: z.string().max(200).optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(20),
});
export type ScimPatch = z.infer<typeof ScimPatchSchema>;

export const ScimListQuery = z.object({
  filter: z.string().max(500).optional(),
  startIndex: z.coerce.number().int().min(1).default(1),
  count: z.coerce.number().int().min(0).max(1000).default(SCIM_PAGE_MAX),
});

// ── 読み取り ──────────────────────────────────────────────────────────────

const FILTER = /^\s*(userName|externalId)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i;

/** 絞り込みの式(userName eq "…" と externalId eq "…" だけ)。ほかは 400 invalidFilter */
export function parseScimFilter(filter: string | undefined): ScimFilter {
  if (filter === undefined || filter.trim() === "") return null;
  const m = FILTER.exec(filter);
  if (!m?.[1] || m[2] === undefined) {
    throw new ScimProblem(400, "invalidFilter", "絞り込みは userName eq と externalId eq だけです");
  }
  const attribute = m[1].toLowerCase() === "username" ? "userName" : "externalId";
  return { attribute, value: m[2].replace(/\\(.)/g, "$1") };
}

const EMAIL = z.email();

/** メールアドレス: userName がメールの形ならそれ、違えば主のメール。どちらも無ければ 400 */
export function emailOf(input: Pick<ScimUserInput, "userName" | "emails">): string {
  const candidates = [
    input.userName,
    input.emails?.find((e) => e.primary)?.value,
    input.emails?.[0]?.value,
  ];
  const found = candidates.find((v) => v !== undefined && EMAIL.safeParse(v.trim()).success);
  if (!found) throw new ScimProblem(400, "invalidValue", "userName はメールアドレスにしてください");
  return found.trim().toLowerCase();
}

type NameSource = {
  displayName?: string | undefined;
  name?: z.infer<typeof NameParts> | undefined;
};

/** 1つの名前にする(無ければ undefined) */
export function nameOf(input: NameSource): string | undefined {
  const parts = [input.name?.familyName, input.name?.givenName].map((p) => p?.trim() ?? "");
  const candidates = [input.displayName, input.name?.formatted, parts.filter(Boolean).join(" ")];
  const found = candidates.map((c) => c?.trim() ?? "").find((c) => c !== "");
  return found?.slice(0, NAME_MAX);
}

export type ScimChange = { name?: string; externalId?: string | null; active?: boolean };

/** PUT(置き換え): 名前・道具の側の ID・有効か。メールを変えようとしたら 400 */
export function changeFromPut(current: ScimMember, input: ScimUserInput): ScimChange {
  refuseEmailChange(current, emailOf(input));
  return {
    name: nameOf(input) ?? current.name,
    externalId: input.externalId ?? null,
    ...(input.active !== undefined ? { active: input.active } : {}),
  };
}

function refuseEmailChange(current: ScimMember, email: string) {
  if (email !== current.email) {
    throw new ScimProblem(400, "mutability", "メールアドレスは SCIM では変えられません");
  }
}

/**
 * PATCH の操作を1つの変更にまとめる(op は大文字小文字を問わない)。扱う path は active・displayName・
 * name.*・externalId・userName(同じ値だけ)。知らない path は聞き流す(道具は扱わない項目もまとめて送る)
 */
export function changeFromPatch(current: ScimMember, patch: ScimPatch): ScimChange {
  const change: ScimChange = {};
  const name: NameSource = {};
  for (const op of patch.Operations) {
    const kind = op.op.toLowerCase();
    if (kind !== "add" && kind !== "replace" && kind !== "remove") {
      throw new ScimProblem(400, "invalidValue", "op は add・replace・remove です");
    }
    const entries: [string, unknown][] = op.path
      ? [[op.path, kind === "remove" ? null : op.value]]
      : Object.entries(asObject(op.value));
    for (const [path, value] of entries) applyPath(current, change, name, path, value);
  }
  const newName = nameOf(name);
  if (newName !== undefined) change.name = newName;
  return change;
}

function applyPath(
  current: ScimMember,
  change: ScimChange,
  name: NameSource,
  path: string,
  value: unknown,
) {
  switch (path.toLowerCase()) {
    case "active":
      change.active = parseValue(ScimBoolean, value, "active");
      return;
    case "externalid":
      change.externalId = value === null ? null : parseValue(z.string().max(255), value, path);
      return;
    case "displayname":
      name.displayName = parseValue(z.string().max(NAME_MAX * 2), value, path);
      return;
    case "name":
      name.name = { ...name.name, ...parseValue(NameParts, value, path) };
      return;
    case "name.formatted":
    case "name.familyname":
    case "name.givenname": {
      const key = { formatted: "formatted", familyname: "familyName", givenname: "givenName" }[
        path.toLowerCase().slice(5) as "formatted" | "familyname" | "givenname"
      ];
      name.name = { ...name.name, [key]: parseValue(z.string().max(NAME_MAX * 2), value, path) };
      return;
    }
    case "username":
      refuseEmailChange(current, parseValue(z.string(), value, path).trim().toLowerCase());
      return;
    default:
      // 扱わない項目(title・addresses・emails[type eq "work"].value など)は聞き流す
      return;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new ScimProblem(400, "invalidValue", "path の無い操作の value はオブジェクトです");
}

function parseValue<T extends z.ZodType>(schema: T, value: unknown, path: string): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new ScimProblem(400, "invalidValue", `${path} の値が正しくありません`);
  return r.data;
}

// ── 出力 ──────────────────────────────────────────────────────────────────

/** SCIM の User の形 */
export function toScimUser(m: ScimMember, basePath: string) {
  return {
    schemas: [SCIM_CORE_SCHEMA],
    id: m.id,
    ...(m.externalId !== null ? { externalId: m.externalId } : {}),
    userName: m.email,
    displayName: m.name,
    name: { formatted: m.name },
    emails: [{ value: m.email, type: "work", primary: true }],
    active: m.active,
    meta: {
      resourceType: "User",
      created: m.createdAt.toISOString(),
      location: `${basePath}/Users/${m.id}`,
    },
  };
}
