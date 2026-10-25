import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  applicationSourceFor,
  fileApplicationSource,
  s3ApplicationSource,
} from "../../src/onboarding/application-source.ts";
import { parseTenantApplication } from "../../src/onboarding/create-tenant.ts";

// 申し込みの JSON(docs/specs/0026-tenant-provisioning.md)。申込書・事前登録の項目をそのまま渡せること。

const minimal = { name: "山田工務店", admin: { email: "Owner@Yamada.test", name: "山田 一郎" } };

describe("申し込みの JSON を読む", () => {
  it("時間帯と二段階認証は既定(Asia/Tokyo・必須にしない)。メールは小文字にそろえる", () => {
    const { application, ignoredKeys } = parseTenantApplication(JSON.stringify(minimal));
    expect(application).toMatchObject({
      name: "山田工務店",
      timeZone: "Asia/Tokyo",
      mfaRequired: false,
      admin: { email: "owner@yamada.test", name: "山田 一郎" },
    });
    expect(ignoredKeys).toEqual([]);
  });

  it("知らない項目(始まりの日・申込番号など)は読み飛ばし、名前だけ返す", () => {
    const { ignoredKeys } = parseTenantApplication(
      JSON.stringify({ ...minimal, startDate: "2026-11-01", orderNumber: "A-1" }),
    );
    expect(ignoredKeys).toEqual(["startDate", "orderNumber"]);
  });

  it("プラン・人数・価格表・据え置きの期限は読む(申込書の欄。docs/specs/0047-plans.md)", () => {
    const { application, ignoredKeys } = parseTenantApplication(
      JSON.stringify({
        ...minimal,
        plan: "standard",
        seats: 10,
        priceList: "2026-10",
        priceLockedUntil: "2027-10-31",
      }),
    );
    expect(application).toMatchObject({
      plan: "standard",
      seats: 10,
      priceList: "2026-10",
      priceLockedUntil: "2027-10-31",
    });
    expect(ignoredKeys).toEqual([]);
    expect(() => parseTenantApplication(JSON.stringify({ ...minimal, seats: 0 }))).toThrow(/seats/);
  });

  it("違う項目の名前だけを言う(値は出さない)", () => {
    const bad = {
      ...minimal,
      timeZone: "Mars/Base",
      admin: { email: "secret-not-mail", name: "" },
    };
    const run = () => parseTenantApplication(JSON.stringify(bad));
    expect(run).toThrow(/timeZone/);
    expect(run).toThrow(/admin\.email/);
    expect(run).toThrow(/admin\.name/);
    expect(run).not.toThrow(/secret-not-mail/);
  });

  it("JSON でなければ止める", () => {
    expect(() => parseTenantApplication("name=山田")).toThrow(/JSON として読めません/);
  });
});

// 申し込みの置き場(docs/designs/0026-tenant-provisioning.md の 5)。引数はキーだけ(CloudTrail に名前・メールを残さない)
describe("申し込みの置き場", () => {
  const fakeS3 = (body: string | Error) => {
    const sent: unknown[] = [];
    return {
      sent,
      client: {
        send: async (command: { input: unknown }) => {
          sent.push(command.input);
          if (body instanceof Error) throw body;
          return { Body: { transformToString: async () => body } };
        },
      } as unknown as Pick<S3Client, "send">,
    };
  };

  it("置き場から、そのキーを読む", async () => {
    const s3 = fakeS3(JSON.stringify(minimal));
    const json = await s3ApplicationSource("apps-bucket", s3.client).read(
      "applications/A-2026-0001.json",
    );
    expect(parseTenantApplication(json).application.name).toBe("山田工務店");
    expect(s3.sent).toEqual([{ Bucket: "apps-bucket", Key: "applications/A-2026-0001.json" }]);
  });

  it("キーの形が違えば読まない(置き場の外・会社や人の名前・道すじの戻り)", async () => {
    const s3 = fakeS3("{}");
    const source = s3ApplicationSource("apps-bucket", s3.client);
    for (const key of [
      "other/A-1.json",
      "applications/山田工務店.json",
      "applications/../secret.json",
      "applications/a b.json",
      "applications/A-1.txt",
    ]) {
      await expect(source.read(key)).rejects.toThrow(/キーの形が違います/);
    }
    expect(s3.sent).toEqual([]);
  });

  it("読めなければ、キーと理由の種類だけを言う", async () => {
    const denied = Object.assign(new Error("Access Denied for owner@yamada.test"), {
      name: "AccessDenied",
    });
    const read = s3ApplicationSource("apps-bucket", fakeS3(denied).client).read(
      "applications/A-1.json",
    );
    await expect(read).rejects.toThrow(
      "申し込みの置き場から読めません: applications/A-1.json(AccessDenied)",
    );
  });

  it("置き場があれば S3、無ければ使い捨ての環境だけ手元のファイル。本番・stg で置き場が無ければ止める", () => {
    expect(applicationSourceFor({ appEnv: "local", bucket: undefined })).toBe(
      fileApplicationSource,
    );
    expect(applicationSourceFor({ appEnv: "prod", bucket: "b" })).not.toBe(fileApplicationSource);
    expect(() => applicationSourceFor({ appEnv: "prod", bucket: undefined })).toThrow(
      /APPLICATIONS_BUCKET/,
    );
    expect(() => applicationSourceFor({ appEnv: "stg", bucket: undefined })).toThrow();
  });
});
