import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// 運営のコマンド(src/tenant-commands.ts。cli.ts の create-tenant・person-data・delete-tenant)の入口。
// 中身(作る・数える・消す)は tenant-provisioning・person-data・offboarding の結合テストが見る。
// ここは引数の確かめ・試しと本番の分かれ・出す JSON 1行(名前・メールを出さない)を、表の持ち主の接続で流して確かめる。

type Commands = typeof import("../../src/tenant-commands.ts");

const owner = createDb(inject("ownerUrl"));
let commands: Commands;
let dir: string;
let other: TenantFixture;
let n = 0;

beforeAll(async () => {
  // コマンドは読み込んだときに環境変数を読む(本番の移行タスクと同じ)
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("MIGRATION_DATABASE_URL", inject("ownerUrl"));
  vi.stubEnv("APPLICATIONS_BUCKET", "");
  vi.stubEnv("SUPPORT_TENANT_ID", "");
  vi.resetModules();
  commands = await import("../../src/tenant-commands.ts");
  dir = await mkdtemp(join(tmpdir(), "tenant-commands-"));
  other = await createTenantFixture(owner.db, "cmd-other");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
  await owner.pool.end();
});

/** コマンドを流し、標準出力の行を返す */
async function run(fn: (args: string[]) => Promise<void>, args: string[]): Promise<string[]> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk).trimEnd());
    return true;
  });
  try {
    await fn(args);
  } finally {
    spy.mockRestore();
  }
  return lines;
}

async function tenantName(tenantId: string): Promise<string> {
  const r = await owner.db.execute<{ name: string }>(
    sql`select name from organizations.tenants where tenant_id = ${tenantId}`,
  );
  return r.rows[0]?.name ?? "";
}

const firstJson = (lines: string[]) => JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;

async function applicationFile(email: string) {
  n += 1;
  const name = `コマンドの組織 ${n}-${Date.now()}`;
  const path = join(dir, `app-${n}.json`);
  await writeFile(
    path,
    JSON.stringify({
      name,
      timeZone: "Asia/Tokyo",
      mfaRequired: false,
      admin: { email, name: "管理 太郎" },
    }),
  );
  return { path, name };
}

describe("create-tenant", () => {
  it("キーが無い・--execute に名前が無いと止まる", async () => {
    await expect(commands.createTenantCommand([])).rejects.toThrow("置き場のキー");
    const { path } = await applicationFile(`new-${Date.now()}@cmd.test`);
    await expect(commands.createTenantCommand([path, "--execute"])).rejects.toThrow(
      "--confirm-name",
    );
  });

  it("試しは何も作らず、ほかの組織に所属している数を出す。本番で作る(名前・メールは出さない)", async () => {
    const { path, name } = await applicationFile(other.users.member.email);
    const plan = await run(commands.createTenantCommand, [path]);
    expect(firstJson(plan)).toMatchObject({ mode: "plan", adminOtherMemberships: 1 });
    expect(plan.join("\n")).not.toContain(other.users.member.email);
    expect(plan[1]).toContain("まだ作っていません");

    const done = await run(commands.createTenantCommand, [
      path,
      "--execute",
      "--confirm-name",
      name,
    ]);
    const line = firstJson(done);
    expect(line).toMatchObject({ mode: "created", adminOtherMemberships: 1 });
    expect(typeof line.tenantId).toBe("string");
  });
});

// ── 事前登録から(設計書 0025 の 5)の道具 ──

/** 運営の組織に、確認済み(か指定の状態)の事前登録を1件足す */
async function preRegistration(opsId: string, status = "confirmed") {
  n += 1;
  const email = `lead-${n}-${Date.now()}@lead.test`;
  const organizationName = `事前登録の会社 ${n}-${Date.now()}`;
  const r = await withTenant(owner.db, opsId, (tx) =>
    tx.execute<{ id: string }>(sql`
      insert into growth.pre_registrations
        (id, tenant_id, email, organization_name, consent_text_version, status, confirmed_at, delete_after)
      values (gen_random_uuid(), ${opsId}, ${email}, ${organizationName}, 1, ${status}, now(), current_date + 365)
      returning id`),
  );
  return { id: r.rows[0]?.id ?? "", email, organizationName };
}

async function rowOf(opsId: string, id: string) {
  const r = await withTenant(owner.db, opsId, (tx) =>
    tx.execute<{ status: string; converted_tenant_id: string | null }>(
      sql`select status, converted_tenant_id from growth.pre_registrations where id = ${id}`,
    ),
  );
  return r.rows[0];
}

/** 管理者の名前だけの申込書(名前・メールは事前登録から埋める) */
async function bareApplication(extra: Record<string, unknown> = {}) {
  n += 1;
  const path = join(dir, `bare-${n}.json`);
  await writeFile(path, JSON.stringify({ admin: { name: "事前 太郎" }, ...extra }));
  return path;
}

describe("create-tenant --from-pre-registration(事前登録から。設計書 0025 の 5)", () => {
  it("運営の組織(SUPPORT_TENANT_ID)が無いと止まる", async () => {
    const pre = { id: "0190a000-0000-7000-8000-000000000000" };
    await expect(
      commands.createTenantCommand([await bareApplication(), "--from-pre-registration", pre.id]),
    ).rejects.toThrow("SUPPORT_TENANT_ID");
  });

  it("試しは何も変えず、本番で事前登録の名前とメールで組織を作り、事前登録を converted にする", async () => {
    const ops = await createTenantFixture(owner.db, "cmd-ops");
    vi.stubEnv("SUPPORT_TENANT_ID", ops.tenantId);
    try {
      const pre = await preRegistration(ops.tenantId);
      const path = await bareApplication();
      const plan = await run(commands.createTenantCommand, [
        path,
        "--from-pre-registration",
        pre.id,
      ]);
      expect(firstJson(plan)).toMatchObject({ mode: "plan", preRegistrationId: pre.id });
      expect(plan.join("\n")).not.toContain(pre.email);
      expect(plan.join("\n")).not.toContain(pre.organizationName);
      expect(await rowOf(ops.tenantId, pre.id)).toMatchObject({ status: "confirmed" });

      const done = await run(commands.createTenantCommand, [
        path,
        "--from-pre-registration",
        pre.id,
        "--execute",
        "--confirm-name",
        pre.organizationName,
      ]);
      const line = firstJson(done);
      expect(line).toMatchObject({ mode: "created", preRegistrationId: pre.id });
      expect(await tenantName(String(line.tenantId))).toBe(pre.organizationName);
      const admin = await owner.db.execute<{ email: string }>(
        sql`select email from organizations.users where tenant_id = ${String(line.tenantId)}`,
      );
      expect(admin.rows.map((r) => r.email)).toEqual([pre.email]);
      expect(await rowOf(ops.tenantId, pre.id)).toEqual({
        status: "converted",
        converted_tenant_id: line.tenantId,
      });

      // もう組織にした登録からは、もう一度は作れない
      await expect(
        commands.createTenantCommand([path, "--from-pre-registration", pre.id]),
      ).rejects.toThrow("確認済みの事前登録がありません");
    } finally {
      vi.stubEnv("SUPPORT_TENANT_ID", "");
    }
  });

  it("確認待ちの登録・申込書と名前やメールが違う登録からは作らない(値は言わない)", async () => {
    const ops = await createTenantFixture(owner.db, "cmd-ops2");
    vi.stubEnv("SUPPORT_TENANT_ID", ops.tenantId);
    try {
      const pending = await preRegistration(ops.tenantId, "pending");
      await expect(
        commands.createTenantCommand([
          await bareApplication(),
          "--from-pre-registration",
          pending.id,
        ]),
      ).rejects.toThrow("確認済みの事前登録がありません");

      const pre = await preRegistration(ops.tenantId);
      const mismatch = commands.createTenantCommand([
        await bareApplication({ name: "別の会社", admin: { name: "x", email: "other@x.test" } }),
        "--from-pre-registration",
        pre.id,
      ]);
      await expect(mismatch).rejects.toThrow("name, admin.email");
      expect(await rowOf(ops.tenantId, pre.id)).toMatchObject({ status: "confirmed" });
    } finally {
      vi.stubEnv("SUPPORT_TENANT_ID", "");
    }
  });
});

describe("person-data", () => {
  it("ID が UUID でなければ止まる(名前・メールを渡させない)", async () => {
    await expect(commands.personDataCommand([])).rejects.toThrow("使い方");
    await expect(
      commands.personDataCommand([other.tenantId, other.users.admin.email]),
    ).rejects.toThrow("使い方");
  });

  it("いる人は数を出し、いない人はそう言う", async () => {
    const found = await run(commands.personDataCommand, [other.tenantId, other.users.viewer.id]);
    expect(firstJson(found)).toMatchObject({ mode: "plan", found: true });
    const missing = await run(commands.personDataCommand, [other.tenantId, other.projectId]);
    expect(firstJson(missing)).toMatchObject({ mode: "plan", found: false });
    expect(missing[1]).toContain("いません");
  });
});

describe("delete-tenant", () => {
  it("ID が無い・無い組織・--execute に名前が無いと止まる", async () => {
    await expect(commands.deleteTenantCommand([])).rejects.toThrow("組織の ID");
    await expect(commands.deleteTenantCommand([other.projectId])).rejects.toThrow(
      "組織がありません",
    );
    await expect(commands.deleteTenantCommand([other.tenantId, "--execute"])).rejects.toThrow(
      "--confirm-name",
    );
  });

  it("試しは数えるだけ。名前を確かめて本番で消す", async () => {
    const t = await createTenantFixture(owner.db, "cmd-delete");
    const plan = await run(commands.deleteTenantCommand, [t.tenantId]);
    expect(firstJson(plan)).toMatchObject({ mode: "plan", tenantId: t.tenantId });
    expect(plan[1]).toContain("まだ消していません");
    const done = await run(commands.deleteTenantCommand, [
      t.tenantId,
      "--execute",
      "--confirm-name",
      await tenantName(t.tenantId),
    ]);
    expect(firstJson(done)).toMatchObject({ mode: "deleted", tenantId: t.tenantId });
  });
});
