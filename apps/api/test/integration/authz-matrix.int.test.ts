import { currentVersion } from "@app/shared";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";
import { ACTORS, loadMatrix, type MatrixActor } from "../helpers/matrix.ts";

// 権限の表の ② : docs/authz/matrix.yaml の全行を、各ロール+他社+未ログインで実際に叩いて答え合わせ。
// 1回ごとに新しい2社を作るので、前の呼び出し(削除など)の影響を受けない。

const owner = createDb(inject("ownerUrl"));
const { app, pool } = createTestApp(inject("appUrl"));
const rows = loadMatrix().filter((r) => r.only_in !== "cognito");

let other: TenantFixture;
let otherAdmin: string;

beforeAll(async () => {
  other = await createTenantFixture(owner.db, "other");
  otherAdmin = await login(app, other.users.admin.email);
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

function fill(template: string, self: TenantFixture): string {
  return (
    template
      .replaceAll("{projectId}", self.projectId)
      .replaceAll("{taskId}", self.taskId)
      .replaceAll("{grantId}", self.supportGrantId)
      .replaceAll("{invitationId}", self.invitationId)
      .replaceAll("{inviteeEmail}", `invitee-${self.tenantId.slice(-12)}@self.test`)
      .replaceAll("{adminEmail}", self.users.admin.email)
      // いまの利用規約の版(数のまま入れる。版を足しても表を直さずに済むように)
      .replaceAll('"{currentTermsVersion}"', String(currentVersion("terms", new Date())?.version))
  );
}

const fillBody = (body: unknown, self: TenantFixture): unknown =>
  body === undefined ? undefined : JSON.parse(fill(JSON.stringify(body), self));

async function cookieFor(actor: MatrixActor, self: TenantFixture): Promise<string | undefined> {
  if (actor === "anonymous") return undefined;
  if (actor === "other_tenant") return otherAdmin;
  return login(app, self.users[actor].email);
}

describe.each(rows)("$route", (row) => {
  const cases = ACTORS.flatMap((actor) => {
    const status = row.expect[actor];
    return status === undefined ? [] : [{ actor, status }];
  });

  it.each(cases)("$actor → $status", async ({ actor, status }) => {
    const self = await createTenantFixture(owner.db, "self");
    const [method = "", path = ""] = row.route.split(" ");
    const res = await call(app, method, fill(path, self), {
      cookie: await cookieFor(actor, self),
      body: fillBody(row.body, self),
    });
    expect(res.status, await res.clone().text()).toBe(status);
  });
});
