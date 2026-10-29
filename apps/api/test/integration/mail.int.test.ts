import { sql } from "drizzle-orm";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { createLogger } from "../../src/logger.ts";
import { createMailer } from "../../src/mail/index.ts";
import { type OutboxEvent, outboxHandlers } from "../../src/outbox/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// タスク完了のメール(docs/specs/0002-task-completed-mail.md)を、本物の SMTP サーバー(Mailpit)まで通す。
//   タスクを完了にする → 同じトランザクションで出来事が積まれる → 受け手が宛先と本文を作る → SMTP で渡す → 届く
// 送り出しのやり直し・2台で重ならないことは outbox.int.test.ts が確かめている。
// ここでは受け手を直接呼ぶ(ほかのテストの送り出しと、同じ出来事を取り合わないように)。

const APP_URL = "https://app.example.test";
const LINK_SECRET = "test-only-".padEnd(40, "x");
const owner = createDb(inject("ownerUrl"));
const appDb = createDb(inject("appUrl"));
const { app, pool } = createTestApp(inject("appUrl"));
const logger = createLogger({ level: "silent" });

let mailpit: StartedTestContainer;
let mailpitApi: string;
let handler: NonNullable<ReturnType<typeof outboxHandlers>["tasks.task_completed"]>;
let acme: TenantFixture;

beforeAll(async () => {
  mailpit = await new GenericContainer("axllent/mailpit:v1.30.0")
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHealthCheck())
    .start();
  mailpitApi = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}/api/v1`;
  const mailer = createMailer(
    {
      smtpUrl: `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`,
      from: "Tasks <no-reply@example.test>",
    },
    logger,
  );
  const handlers = outboxHandlers({
    db: appDb.db,
    logger,
    mailer,
    appUrl: APP_URL,
    linkSecret: LINK_SECRET,
  });
  if (!handlers["tasks.task_completed"]) throw new Error("受け手が無い");
  handler = handlers["tasks.task_completed"];
  acme = await createTenantFixture(owner.db, "acme");
}, 180_000);

afterAll(async () => {
  await mailpit?.stop();
  await owner.pool.end();
  await appDb.pool.end();
  await pool.end();
});

/** 画面と同じく API で完了にして、積まれた出来事を読む */
async function completeTask(t: TenantFixture, as: "admin" | "member", taskId = t.taskId) {
  const cookie = await login(app, t.users[as].email);
  const res = await call(app, "PATCH", `/api/tasks/${taskId}`, { cookie, body: { done: true } });
  expect(res.status).toBe(200);
  const r = await owner.db.execute<{
    id: string;
    tenant_id: string;
    topic: string;
    payload: unknown;
    attempts: number;
    created_at: Date;
  }>(
    sql`select id, tenant_id, topic, payload, attempts, created_at from platform.outbox
        where tenant_id = ${t.tenantId} and payload->>'taskId' = ${taskId}
        order by created_at desc limit 1`,
  );
  const row = r.rows[0];
  if (!row) throw new Error("出来事が積まれていない");
  return {
    id: row.id,
    tenantId: row.tenant_id,
    topic: "tasks.task_completed",
    payload: row.payload,
    attempts: row.attempts,
    createdAt: new Date(row.created_at),
  } satisfies OutboxEvent;
}

type Summary = { ID: string; MessageID: string; Subject: string; To: { Address: string }[] };
async function inbox(to: string): Promise<Summary[]> {
  const res = await fetch(`${mailpitApi}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await res.json()) as { messages: Summary[] }).messages;
}
async function body(id: string): Promise<string> {
  const res = await fetch(`${mailpitApi}/message/${id}`);
  return ((await res.json()) as { Text: string }).Text;
}

describe("タスク完了のメール", () => {
  it("メンバーが完了にすると、プロジェクトを作った人(管理者)に届く", async () => {
    const event = await completeTask(acme, "member");
    expect(event.payload).toMatchObject({ completedBy: acme.users.member.id });
    await handler(event);

    const [mail, ...rest] = await inbox(acme.users.admin.email);
    expect(rest).toEqual([]);
    expect(mail?.Subject).toBe("タスク「最初のタスク」が完了しました");
    expect(mail?.MessageID).toBe(`task-completed.${event.id}@app.example.test`);
    const text = await body(mail?.ID ?? "");
    expect(text).toContain("プロジェクト「最初の計画」");
    expect(text).toContain(`${APP_URL}/projects/${acme.projectId}`);
    // 完了にした本人(メンバー)には送らない
    expect(await inbox(acme.users.member.email)).toEqual([]);
  });

  it("自分で作ったプロジェクトのタスクを自分で完了にしたら、送らない", async () => {
    const t = await createTenantFixture(owner.db, "self");
    await handler(await completeTask(t, "admin"));
    expect(await inbox(t.users.admin.email)).toEqual([]);
  });

  it("送るまでの間に未完了に戻されたら、送らない", async () => {
    const t = await createTenantFixture(owner.db, "reopen");
    const event = await completeTask(t, "member");
    const cookie = await login(app, t.users.member.email);
    await call(app, "PATCH", `/api/tasks/${t.taskId}`, { cookie, body: { done: false } });
    await handler(event);
    expect(await inbox(t.users.admin.email)).toEqual([]);
  });

  // 組織ごとに止める・戻す(docs/specs/0093-task-mail-switch.md)。止める・戻すの API そのものは task-mail.int.test.ts
  it("件名に改行を入れても、ヘッダーは増えない(ヘッダーの注入)", async () => {
    const t = await createTenantFixture(owner.db, "inject");
    const cookie = await login(app, t.users.member.email);
    await call(app, "PATCH", `/api/tasks/${t.taskId}`, {
      cookie,
      body: { title: "悪い題名\r\nBcc: attacker@evil.example" },
    });
    await handler(await completeTask(t, "member"));
    const [mail] = await inbox(t.users.admin.email);
    expect(mail?.Subject).toContain("悪い題名");
    expect(await inbox("attacker@evil.example")).toEqual([]);
  });

  it("SMTP に届かなければ投げる(アウトボックスがやり直す)", async () => {
    const t = await createTenantFixture(owner.db, "down");
    const event = await completeTask(t, "member");
    const down = outboxHandlers({
      db: appDb.db,
      logger,
      linkSecret: LINK_SECRET,
      // 誰も待っていないポート
      mailer: createMailer({ smtpUrl: "smtp://127.0.0.1:1", from: "x <x@example.test>" }, logger),
      appUrl: APP_URL,
    })["tasks.task_completed"];
    await expect(down?.(event)).rejects.toThrow();
    expect(await inbox(t.users.admin.email)).toEqual([]);
  });
});

describe("組織ごとに、タスクが完了したメールを止める・戻す(仕様 0093)", () => {
  it("管理者が止めた組織には送らない。止める前に積まれた出来事も送らない", async () => {
    const t = await createTenantFixture(owner.db, "mail-off");
    const before = await completeTask(t, "member");
    const admin = await login(app, t.users.admin.email);
    expect(
      (await call(app, "DELETE", "/api/organization/task-mail", { cookie: admin })).status,
    ).toBe(204);
    await handler(before);
    expect(await inbox(t.users.admin.email)).toEqual([]);
  });

  it("戻すと、その後に完了した物は前と同じように届く(止めていた間の分は届かない)", async () => {
    const t = await createTenantFixture(owner.db, "mail-on");
    const admin = await login(app, t.users.admin.email);
    const member = await login(app, t.users.member.email);
    await call(app, "DELETE", "/api/organization/task-mail", { cookie: admin });
    const whileOff = await completeTask(t, "member");
    await handler(whileOff);
    expect((await call(app, "POST", "/api/organization/task-mail", { cookie: admin })).status).toBe(
      204,
    );
    await call(app, "PATCH", `/api/tasks/${t.taskId}`, { cookie: member, body: { done: false } });
    const afterOn = await completeTask(t, "member");
    await handler(afterOn);
    const mails = await inbox(t.users.admin.email);
    expect(mails.map((m) => m.MessageID)).toEqual([
      `task-completed.${afterOn.id}@app.example.test`,
    ]);
  });

  it("止めている間に完了し、送り出しが動く前に戻しても、その分は送らない(設計書 0089 の 13)", async () => {
    const t = await createTenantFixture(owner.db, "mail-race");
    const admin = await login(app, t.users.admin.email);
    await call(app, "DELETE", "/api/organization/task-mail", { cookie: admin });
    const whileOff = await completeTask(t, "member");
    // 完了した時点で止めていたことが、出来事に積まれている(送らない理由は mail_off_at_completion)
    expect(whileOff.payload).toMatchObject({ mailOffAtCompletion: true });
    // 送り出しが動く前に戻す(前は、送る直前に今の設定だけを見ていたので届いていた)
    expect((await call(app, "POST", "/api/organization/task-mail", { cookie: admin })).status).toBe(
      204,
    );
    await handler(whileOff);
    expect(await inbox(t.users.admin.email)).toEqual([]);
  });

  it("別の組織が止めていても、こちらの組織の完了は止めていない扱いで積まれ、届く", async () => {
    const other = await createTenantFixture(owner.db, "mail-other-off");
    await call(app, "DELETE", "/api/organization/task-mail", {
      cookie: await login(app, other.users.admin.email),
    });
    const t = await createTenantFixture(owner.db, "mail-this-on");
    const event = await completeTask(t, "member");
    expect(event.payload).toMatchObject({ mailOffAtCompletion: false });
    await handler(event);
    expect(await inbox(t.users.admin.email)).toHaveLength(1);
  });
});
