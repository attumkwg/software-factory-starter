import { currentVersion, type Role } from "@app/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { recordAudit } from "../../src/audit/record.ts";
import { createDb } from "../../src/db/client.ts";
import { projects, tasks, tenants, users } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import {
  call,
  createFileFixture,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";
import { ACTORS, loadMatrix, type MatrixActor, type MatrixRow } from "../helpers/matrix.ts";

// API の返事に、そのロールに見せてはいけない個人情報が混ざらないことを、全部の API で確かめる。
// authz-matrix.int.test.ts は番号だけを見る。@hono/zod-openapi は返事を検証も削りもしないので、
// DB の行をそのまま c.json に渡すと、他人のメールアドレスや名前が member・viewer に返る。
// 1人ずつ違う目印(名前・メールアドレス)を付け、権限の表の全行 × 全ロールで叩き、2xx の本文を見る。
// - 自社の人: 本人の目印と会社の目印(会社名・計画・タスク・ファイルの名前)は出てよい。他人の目印は ALLOWED の物だけ
// - 他社と未ログイン: その会社の目印は1つも出てはいけない(ALLOWED でも許さない)
// - 叩く人が本文で送った値は、返ってきても漏れではない(招待を作ると、渡した相手のメールアドレスが返る)

type InTenant = Exclude<MatrixActor, "other_tenant" | "anonymous">;
/** 他社と未ログイン(その会社の目印を1つも見せない相手) */
const isOutsider = (a: MatrixActor): a is "other_tenant" | "anonymous" =>
  a === "other_tenant" || a === "anonymous";

/**
 * 他人の個人情報を返してよい組み合わせ(行 → ロール → 理由)。自社の人だけ書ける(他社と未ログインは書けない)。
 * 許したのに一度も出なかったら落ちる(もう要らない許しを残さない)。
 */
const ALLOWED: Record<string, Partial<Record<InTenant, string>>> = {
  "GET /api/organization/members": {
    admin:
      "管理者が組織の人の一覧を見る(止める・戻す・ロールを変えるのに名前とメールアドレスが要る)",
  },
  "PUT /api/organization/members/{memberId}/role": {
    admin: "ロールを変えた相手を返す(管理者の一覧の画面がその行を直す)",
  },
  "POST /api/organization/members/{memberId}/disable": {
    admin: "止めた相手を返す(管理者の一覧の画面がその行を直す)",
  },
  "POST /api/organization/members/{memberId}/enable": {
    admin: "戻した相手を返す(管理者の一覧の画面がその行を直す)",
  },
  "GET /api/invitations": {
    admin: "管理者が出した招待の一覧(招いた相手のメールアドレス。取り消すか決めるのに要る)",
  },
  "GET /api/audit-events": {
    admin: "監査ログの「誰が」に自社の人の名前(誰が何をしたかを管理者が確かめる)",
  },
  "POST /api/exports": {
    admin: "組織のデータの書き出し(解約・持ち出しのために全員の名前とメールアドレスを入れる)",
  },
};

const owner = createDb(inject("ownerUrl"));
const { app, pool } = createTestApp(inject("appUrl"));
const rows = loadMatrix().filter((r) => r.only_in !== "cognito");
const IN_TENANT: readonly InTenant[] = ["admin", "member", "viewer"];

/** 目印をつけた1社。people は人ごとの目印、invitees は招いた相手(まだ組織の人でない)、company は会社の目印 */
type Marked = {
  f: TenantFixture;
  people: Record<Role, string[]>;
  invitees: string[];
  company: string[];
  /** 本文で招く相手(POST /api/invitations の {inviteeEmail}) */
  inviteeEmail: string;
};

let other: TenantFixture;
/** 他人の目印が出た(許した)組み合わせ。許しが使われたかを最後に確かめる */
const used = new Set<string>();
let checked = 0;

beforeAll(async () => {
  other = await createTenantFixture(owner.db, "other");
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

/** 1社を作り、人ごとに違う名前を付け、会社の値も目印にする。member と viewer の監査ログも1行ずつ足す */
async function markedTenant(): Promise<Marked> {
  const f = await createTenantFixture(owner.db, "self");
  const suffix = f.tenantId.slice(-12);
  const nameOf = (role: Role) => `目印の人-${role}-${suffix}`;
  const company = [
    `目印の会社-${suffix}`,
    `目印の計画-${suffix}`,
    `目印のタスク-${suffix}`,
    `目印のファイル-${suffix}.jpg`,
  ];
  await withTenant(owner.db, f.tenantId, async (tx) => {
    await tx.update(tenants).set({ name: company[0] }).where(eq(tenants.tenantId, f.tenantId));
    for (const role of IN_TENANT)
      await tx
        .update(users)
        .set({ name: nameOf(role) })
        .where(eq(users.id, f.users[role].id));
    await tx.update(projects).set({ name: company[1] }).where(eq(projects.id, f.projectId));
    await tx.update(tasks).set({ title: company[2] }).where(eq(tasks.id, f.taskId));
    for (const role of ["member", "viewer"] as const)
      await recordAudit(tx, {
        tenantId: f.tenantId,
        actor: { kind: "user", id: f.users[role].id },
        action: "project.create",
        target: { type: "project", id: f.projectId },
        outcome: "allowed",
      });
  });
  const inviteeEmail = `invitee-${suffix}@self.test`;
  return {
    f,
    people: {
      admin: [nameOf("admin"), f.users.admin.email],
      member: [nameOf("member"), f.users.member.email],
      viewer: [nameOf("viewer"), f.users.viewer.email],
    },
    invitees: [`invited-${suffix}@self.test`, inviteeEmail],
    company,
    inviteeEmail,
  };
}

/** 叩く人に見せてはいけない目印(自社の人なら他人の目印、他社と未ログインなら全部。本文で送った値は除く) */
function forbiddenFor(actor: MatrixActor, m: Marked, sent: string): string[] {
  const allPeople = [...Object.values(m.people).flat(), ...m.invitees];
  const all = isOutsider(actor) ? [...allPeople, ...m.company] : allPeople;
  const mine = isOutsider(actor) ? [] : m.people[actor];
  return all.filter((v) => !mine.includes(v) && !sent.includes(v));
}

// 置き換えは authz-matrix.int.test.ts と同じ(叩く物が同じになるように)
function fill(template: string, m: Marked): string {
  const self = m.f;
  return template
    .replaceAll("{projectId}", self.projectId)
    .replaceAll("{taskId}", self.taskId)
    .replaceAll("{grantId}", self.supportGrantId)
    .replaceAll("{invitationId}", self.invitationId)
    .replaceAll("{tenantId}", self.tenantId)
    .replaceAll("{inviteeEmail}", m.inviteeEmail)
    .replaceAll("{adminEmail}", self.users.admin.email)
    .replaceAll("{domainId}", self.projectId)
    .replaceAll("{memberId}", self.users.member.id)
    .replaceAll("{tokenId}", self.projectId)
    .replaceAll("{scimUserId}", self.users.member.id)
    .replaceAll('"{currentTermsVersion}"', String(currentVersion("terms", new Date())?.version));
}

/** {fileId} は叩く人が上げたことにした、名前が目印のファイル(他社・未ログインは自社の管理者の物) */
async function withFile(template: string, actor: MatrixActor, m: Marked): Promise<string> {
  if (!template.includes("{fileId}")) return template;
  const uploader = isOutsider(actor) ? m.f.users.admin.id : m.f.users[actor].id;
  const id = await createFileFixture(owner.db, m.f, uploader, "ready", m.company[3]);
  return template.replaceAll("{fileId}", id);
}

// 他社の管理者は毎回ログインし直す(表のログアウトの行で、前の Cookie が使えなくなるため)
async function cookieFor(actor: MatrixActor, m: Marked): Promise<string | undefined> {
  if (actor === "anonymous") return undefined;
  if (actor === "other_tenant") return login(app, other.users.admin.email);
  return login(app, m.f.users[actor].email);
}

/** 表の1行を叩き、2xx なら本文と、叩く人が本文で送った値を返す(2xx 以外は null) */
async function hit(row: MatrixRow, actor: MatrixActor, m: Marked) {
  const [method = "", template = ""] = row.route.split(" ");
  const path = fill(await withFile(template, actor, m), m);
  const sent = row.body === undefined ? "" : fill(JSON.stringify(row.body), m);
  const body = row.body === undefined ? undefined : JSON.parse(sent);
  const res = await call(app, method, path, { cookie: await cookieFor(actor, m), body });
  if (res.status < 200 || res.status >= 300) return null;
  return { status: res.status, text: await res.text(), sent };
}

describe("返事に、見せてはいけない個人情報が混ざらない", () => {
  describe.each(rows)("$route", (row) => {
    it.each([...ACTORS])("%s", async (actor) => {
      const m = await markedTenant();
      const got = await hit(row, actor, m);
      if (!got) return;
      checked += 1;
      const leaked = forbiddenFor(actor, m, got.sent).filter((v) => got.text.includes(v));
      if (leaked.length > 0 && !isOutsider(actor) && ALLOWED[row.route]?.[actor]) {
        used.add(`${row.route} ${actor}`);
        return;
      }
      expect(
        leaked,
        `${row.route} を ${actor} が叩いた返事(${got.status})に、他人の目印が出ています`,
      ).toEqual([]);
    });
  });

  it("2xx の返事を十分な数だけ見た", () => {
    expect(checked).toBeGreaterThan(50);
  });

  it("許した組み合わせは、どれも実際に他人の目印が出ている(要らない許しを残さない)", () => {
    const declared = Object.entries(ALLOWED).flatMap(([route, byActor]) =>
      Object.keys(byActor).map((actor) => `${route} ${actor}`),
    );
    expect(declared.filter((k) => !used.has(k))).toEqual([]);
  });
});
