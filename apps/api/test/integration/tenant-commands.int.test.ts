import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createDb } from "../../src/db/client.ts";
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
