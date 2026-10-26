import { describe, expect, it } from "vitest";
import {
  changeFromPatch,
  changeFromPut,
  emailOf,
  nameOf,
  parseScimFilter,
  ScimProblem,
  ScimUserInputSchema,
  scimErrorBody,
  toScimUser,
} from "../../src/auth/scim-protocol.ts";
import { ApiError } from "../../src/errors.ts";

// SCIM の形(src/auth/scim-protocol.ts)。DB を使わない読み取りと組み立て。
// 流れ(鍵・組織・止める)は test/integration/scim.int.test.ts。

const current = {
  id: "0190a4d2-0000-7000-8000-000000000001",
  email: "taro@acme.test",
  name: "山田 太郎",
  externalId: "ext-1",
  active: true,
  createdAt: new Date("2026-10-26T00:00:00Z"),
};

const problemOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ScimProblem ? e.scimType : "other";
  }
  return "none";
};

describe("絞り込みの式", () => {
  it("userName eq と externalId eq だけ(大文字小文字を問わない・エスケープを戻す)", () => {
    expect(parseScimFilter(undefined)).toBeNull();
    expect(parseScimFilter('userName eq "a@acme.test"')).toEqual({
      attribute: "userName",
      value: "a@acme.test",
    });
    expect(parseScimFilter('EXTERNALID EQ "x\\"y"')).toEqual({
      attribute: "externalId",
      value: 'x"y',
    });
    expect(problemOf(() => parseScimFilter('title co "x"'))).toBe("invalidFilter");
    expect(problemOf(() => parseScimFilter('userName eq "a" or userName eq "b"'))).toBe(
      "invalidFilter",
    );
  });
});

describe("メールと名前", () => {
  it("userName がメールでなければ主のメール。どちらも無ければ invalidValue", () => {
    expect(emailOf({ userName: "Taro@Acme.test" })).toBe("taro@acme.test");
    expect(
      emailOf({
        userName: "taro",
        emails: [
          { value: "x@acme.test", primary: false },
          { value: "t@acme.test", primary: true },
        ],
      }),
    ).toBe("t@acme.test");
    expect(problemOf(() => emailOf({ userName: "taro" }))).toBe("invalidValue");
  });

  it("displayName → formatted → 姓 名 の順", () => {
    expect(nameOf({ displayName: " 表示 ", name: { formatted: "整形" } })).toBe("表示");
    expect(nameOf({ name: { formatted: "整形", familyName: "山田" } })).toBe("整形");
    expect(nameOf({ name: { familyName: "山田", givenName: "太郎" } })).toBe("山田 太郎");
    expect(nameOf({})).toBeUndefined();
  });

  it("Entra ID の真偽の文字を読む", () => {
    const r = ScimUserInputSchema.parse({ userName: "a@acme.test", active: "False" });
    expect(r.active).toBe(false);
  });
});

describe("PUT と PATCH", () => {
  it("PUT は名前・externalId・active。メールを変えると mutability", () => {
    expect(
      changeFromPut(current, { userName: "taro@acme.test", displayName: "新", active: false }),
    ).toEqual({ name: "新", externalId: null, active: false });
    expect(problemOf(() => changeFromPut(current, { userName: "jiro@acme.test" }))).toBe(
      "mutability",
    );
  });

  it("PATCH の path つき・path なし・remove・知らない項目", () => {
    expect(
      changeFromPatch(current, {
        Operations: [
          { op: "Replace", path: "active", value: "False" },
          { op: "replace", path: "name.givenName", value: "次郎" },
          { op: "replace", path: "name.familyName", value: "山田" },
          { op: "remove", path: "externalId" },
          { op: "add", path: 'emails[type eq "work"].value', value: "z@acme.test" },
        ],
      }),
    ).toEqual({ active: false, externalId: null, name: "山田 次郎" });
    expect(
      changeFromPatch(current, {
        Operations: [{ op: "replace", value: { active: true, displayName: "太郎" } }],
      }),
    ).toEqual({ active: true, name: "太郎" });
    expect(
      changeFromPatch(current, {
        Operations: [{ op: "replace", path: "userName", value: "TARO@acme.test" }],
      }),
    ).toEqual({});
  });

  it("PATCH の誤り: 知らない op・値の型・path なしで値がオブジェクトでない・メールの変更", () => {
    const patch = (op: Record<string, unknown>) => () =>
      changeFromPatch(current, { Operations: [op as { op: string }] });
    expect(problemOf(patch({ op: "move", path: "active", value: true }))).toBe("invalidValue");
    expect(problemOf(patch({ op: "replace", path: "active", value: "yes" }))).toBe("invalidValue");
    expect(problemOf(patch({ op: "replace", value: "x" }))).toBe("invalidValue");
    expect(problemOf(patch({ op: "replace", path: "userName", value: "x@acme.test" }))).toBe(
      "mutability",
    );
  });
});

describe("出力", () => {
  it("User の形(externalId が無ければ出さない)", () => {
    const u = toScimUser({ ...current, externalId: null }, "/api/scim/v2");
    expect(u).toMatchObject({
      id: current.id,
      userName: "taro@acme.test",
      displayName: "山田 太郎",
      active: true,
      meta: { resourceType: "User", location: `/api/scim/v2/Users/${current.id}` },
    });
    expect("externalId" in u).toBe(false);
  });

  it("Error の形(scimType は決めた物・400 と 409 の既定・ほかは無し)", () => {
    expect(scimErrorBody(new ScimProblem(400, "invalidFilter", "x"))).toMatchObject({
      status: "400",
      scimType: "invalidFilter",
    });
    expect(scimErrorBody(new ApiError(409, "already_member", "x")).scimType).toBe("uniqueness");
    expect(scimErrorBody(new ApiError(401, "unauthorized", "x"))).not.toHaveProperty("scimType");
  });
});
