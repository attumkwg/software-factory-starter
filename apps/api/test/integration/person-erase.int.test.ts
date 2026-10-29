import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { COLUMN_CLASSIFICATION } from "../../src/db/classification.ts";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { TENANT_TABLES } from "../../src/offboarding/delete-tenant.ts";
import {
  ANONYMIZE,
  ERASED_NAME,
  erasePersonData,
  KEPT_PERSONAL_COLUMNS,
} from "../../src/person-data/erase-person-data.ts";
import { PERSON_REFERENCES, planPersonData } from "../../src/person-data/plan-person-data.ts";
import { createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// 利用者1人分を消す・匿名化する(docs/specs/0089-person-erase.md)。2社(a・b)で。
// 列の分類(classification.ts)の personal の列と突き合わせ、本人の値が残らないことを見る。

const owner = createDb(inject("ownerUrl"));
let a: TenantFixture;
let b: TenantFixture;
const oldEmail = () => `old-${a.users.member.id}@acme.test`;

/** その人だけの記録を、表ごとに1行ずつ作る(古いメールへの招待・メールの変更・お知らせ・利用・送信待ち) */
async function seedPersonRows(t: TenantFixture, old: string) {
  const u = t.users.member;
  await withTenant(owner.db, t.tenantId, async (tx) => {
    await tx.execute(sql`insert into organizations.email_changes
      (id, tenant_id, user_id, previous_email, new_email, confirmed_at)
      values (gen_random_uuid(), ${t.tenantId}, ${u.id}, ${old}, ${u.email}, now())`);
    await tx.execute(sql`insert into organizations.invitations
      (id, tenant_id, email, role, invited_by, expires_at, accepted_at, accepted_user_id)
      values (gen_random_uuid(), ${t.tenantId}, ${old}, 'member', ${t.users.admin.id},
        now() + interval '1 day', now(), ${u.id})`);
    await tx.execute(sql`insert into legal.notices (id, tenant_id, user_id, document, version)
      values (gen_random_uuid(), ${t.tenantId}, ${u.id}, 'terms', 20991231)`);
    await tx.execute(sql`insert into platform.feature_usage (id, tenant_id, user_id, feature, day)
      values (gen_random_uuid(), ${t.tenantId}, ${u.id}, 'erase-test', current_date)`);
    await tx.execute(sql`insert into platform.pmf_survey_asked (id, tenant_id, user_id, round, day)
      values (gen_random_uuid(), ${t.tenantId}, ${u.id}, '2099-Q4', current_date)`);
    // 送り出しに拾われないように、送ってよい時刻を先にする
    await tx.execute(sql`insert into platform.outbox (id, tenant_id, topic, payload, available_at)
      values (gen_random_uuid(), ${t.tenantId}, 'legal.notice',
        ${JSON.stringify({ userId: u.id })}::jsonb, now() + interval '1 year')`);
    await tx.execute(
      sql`update organizations.users set external_id = ${`sub-${u.id}`},
            scim_external_id = ${`scim-${u.id}`} where id = ${u.id}`,
    );
  });
}

/** 試しの anonymize と delete の合計(--confirm-rows に渡す数) */
async function changingRows(t: TenantFixture) {
  const plan = await planPersonData(owner.db, t.tenantId, t.users.member.id);
  return plan.totals.anonymize + plan.totals.delete;
}

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  await seedPersonRows(a, oldEmail());
  await seedPersonRows(b, `old-${b.users.member.id}@globex.test`);
});
afterAll(async () => {
  await owner.pool.end();
});

describe("消すときの一覧と列の分類", () => {
  it("扱いが anonymize の表には、置き換える列がある", () => {
    const tables = new Set(
      PERSON_REFERENCES.filter((r) => r.action === "anonymize").map((r) => r.table),
    );
    expect([...tables].filter((t) => !ANONYMIZE[t])).toEqual([]);
  });

  it("一覧の表の personal・sensitive の列は、行ごと消すか・置き換えるか・残す理由がある", () => {
    const deleted = new Set(
      PERSON_REFERENCES.filter((r) => r.action === "delete").map((r) => r.table),
    );
    const listed = new Set(PERSON_REFERENCES.map((r) => r.table));
    const left = Object.entries(COLUMN_CLASSIFICATION)
      .filter(([, c]) => c.class === "personal" || c.class === "sensitive")
      .map(([key]) => key)
      .filter((key) => {
        const t = key.split(".").slice(0, 2).join(".");
        const col = key.split(".")[2] as string;
        if (!listed.has(t) || deleted.has(t)) return false;
        return !ANONYMIZE[t]?.[col] && !KEPT_PERSONAL_COLUMNS[key];
      });
    expect(left, "erase-person-data.ts の ANONYMIZE か KEPT_PERSONAL_COLUMNS に足す").toEqual([]);
  });

  it("置き換える列と残す列は、どれも列の分類にある(書き間違いで黙って通らない)", () => {
    const named = [
      ...Object.entries(ANONYMIZE).flatMap(([t, cols]) =>
        Object.keys(cols).map((c) => `${t}.${c}`),
      ),
      ...Object.keys(KEPT_PERSONAL_COLUMNS),
    ];
    expect(named.filter((k) => !COLUMN_CLASSIFICATION[k])).toEqual([]);
  });
});

describe("1人分を消す", () => {
  it("試しの数と --confirm-rows が違えば、何も変えずに止める", async () => {
    const n = await changingRows(a);
    await expect(
      erasePersonData(owner.db, a.tenantId, a.users.member.id, {
        confirmRows: n + 1,
        supportTenantId: null,
      }),
    ).rejects.toThrow(/confirm-rows/);
    expect(await changingRows(a)).toBe(n);
  });

  it("その組織にいない人(他社の人)は止める。運営の組織の人は消さない", async () => {
    await expect(
      erasePersonData(owner.db, a.tenantId, b.users.member.id, {
        confirmRows: 0,
        supportTenantId: null,
      }),
    ).rejects.toThrow(/いません/);
    await expect(
      erasePersonData(owner.db, a.tenantId, a.users.member.id, {
        confirmRows: 0,
        supportTenantId: a.tenantId,
      }),
    ).rejects.toThrow(/運営の組織/);
  });

  it("消した後は、試しの delete が0で、本人の名前・メール(古いメールも)がどの personal の列にも残らない", async () => {
    const u = a.users.member;
    const [{ name } = { name: "" }] = (
      await withTenant(owner.db, a.tenantId, (tx) =>
        tx.execute<{ name: string }>(sql`select name from organizations.users where id = ${u.id}`),
      )
    ).rows;
    const before = await planPersonData(owner.db, a.tenantId, u.id);
    expect(before.totals.delete).toBeGreaterThanOrEqual(5);
    const done = await erasePersonData(owner.db, a.tenantId, u.id, {
      confirmRows: before.totals.anonymize + before.totals.delete,
      supportTenantId: null,
    });
    expect(done).toMatchObject({ mode: "erased", found: true, cognitoSub: `sub-${u.id}` });
    expect(JSON.stringify(done)).not.toContain(u.email);

    const after = await planPersonData(owner.db, a.tenantId, u.id);
    expect(after.totals.delete).toBe(0);
    expect(after.cognitoSub).toBeNull();
    // 残す物(監査ログ・同意)は残る
    expect(after.totals.keep).toBeGreaterThanOrEqual(before.totals.keep);

    // 列の分類の personal の列(text)を、その組織の中で全部探す
    const tenantTables = new Set<string>(TENANT_TABLES);
    const values = [u.email, oldEmail(), name, `scim-${u.id}`];
    const personalColumns = Object.entries(COLUMN_CLASSIFICATION)
      .filter(([key, c]) => c.class === "personal" && !KEPT_PERSONAL_COLUMNS[key])
      .map(([key]) => key)
      .filter((key) => tenantTables.has(key.split(".").slice(0, 2).join(".")));
    const found: string[] = [];
    await withTenant(owner.db, a.tenantId, async (tx) => {
      for (const key of personalColumns) {
        const [schema, rel, col] = key.split(".") as [string, string, string];
        const r = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(schema)}.${sql.identifier(rel)}
               where tenant_id = ${a.tenantId} and ${sql.identifier(col)}::text in ${values}`,
        );
        if ((r.rows[0]?.n ?? 0) > 0) found.push(key);
      }
    });
    expect(found).toEqual([]);

    const row = await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute<{ name: string; disabled: boolean; external_id: string | null }>(
        sql`select name, disabled_at is not null as disabled, external_id
              from organizations.users where id = ${u.id}`,
      ),
    );
    expect(row.rows[0]).toEqual({ name: ERASED_NAME, disabled: true, external_id: null });
  });

  it("その組織の監査ログに、仕組みが消したと件数だけで残る(値は入らない)", async () => {
    const r = await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute<{ actor_kind: string; target_type: string; details: Record<string, number> }>(
        sql`select actor_kind, target_type, details from platform.audit_events
             where tenant_id = ${a.tenantId} and action = 'person.erase' and target_id = ${a.users.member.id}`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ actor_kind: "system", target_type: "member" });
    expect(Object.keys(r.rows[0]?.details ?? {}).sort()).toEqual(["anonymize", "delete"]);
  });

  it("ほかの組織の同じ形の行は変わらない", async () => {
    const plan = await planPersonData(owner.db, b.tenantId, b.users.member.id);
    expect(plan.totals.delete).toBeGreaterThanOrEqual(5);
    expect(plan.cognitoSub).toBe(`sub-${b.users.member.id}`);
  });

  it("同じ人をもう一度消しても、消す物は無い(手順書の確かめ)", async () => {
    const n = await changingRows(a);
    const again = await erasePersonData(owner.db, a.tenantId, a.users.member.id, {
      confirmRows: n,
      supportTenantId: null,
    });
    expect(again.totals.delete).toBe(0);
  });
});
