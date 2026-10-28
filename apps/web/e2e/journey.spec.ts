import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { currentPreRegistrationConsent } from "@app/shared";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { expectAccessible } from "./helpers.ts";
import { operator, operatorAvailable } from "./operator.ts";

// SaaS の一周(穴 G-119・「使える」の条件 2。docs/scenarios/gaps.md の頭)。
// docker compose を本番の代わりにして、1つの会社が来てから去るまでを1本でたどる:
//   事前登録 → 開通 → 最初の管理者 → 招待 → 機能と写真 → プラン → 書き出し → 人を外す → 1人分の削除 → 解約
// 運営の手(開通・プラン・解約)は、本番の ECS の1回きりのタスクの代わりに、移行のコンテナで同じコマンドを流す(operator.ts)。
// 部品ごとの細かい確かめは、それぞれの spec(invitations・export・tenant-isolation など)と API の結合テストにある。
// ここで見るのは「つながるか」だけ。まだ無い段は「未」の印(annotations)を付けて先へ進む(報告に穴の番号が出る)。

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

type Message = { ID: string; Subject: string };

async function mailsTo(address: string): Promise<Message[]> {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  return ((await res.json()) as { messages: Message[] }).messages;
}

/** 宛先に届いたメールの本文から、形に合う最初のリンクを取る(まだ無ければ null) */
async function linkIn(address: string, pattern: RegExp): Promise<string | null> {
  for (const message of await mailsTo(address)) {
    const body = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
      Text: string;
    };
    const found = body.Text.match(pattern)?.[0];
    if (found) return found;
  }
  return null;
}

/** 開発用ログイン → 初めてなので利用規約の同意(管理者は「組織を代表して」)→ プロジェクトの一覧 */
async function logIn(page: Page, email: string, as: "admin" | "member") {
  await page.goto("/");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page
    .getByText(
      as === "admin"
        ? "上の内容を確かめ、組織を代表して同意します"
        : "上の内容を確かめ、同意します",
    )
    .click();
  await page.getByRole("button", { name: "同意する" }).click();
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path);
  expect(res.status(), path).toBe(200);
  return (await res.json()) as T;
}

/** 撮った場所の文字を tEXt に入れた 1x1 の PNG(置き場に入る前に、この塊が外れることを見る) */
function pngWithText(text: string): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  // 1x1 の透明な画素(行の頭のフィルターの 0 と RGBA)
  const idat = deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from(`Location\0${text}`, "latin1")),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** まだ無い段。報告に穴の番号を出して、先へ進む */
function notYet(gap: string, what: string) {
  test.info().annotations.push({ type: `未(${gap})`, description: what });
}

/** 一周でたどる1つの会社(毎回、名前とメールを新しくする) */
type Company = {
  orgName: string;
  adminEmail: string;
  memberEmail: string;
  projectName: string;
  /** 写真に埋めた撮った場所(置き場に入る前に消えるはず) */
  secretPlace: string;
};

function newCompany(): Company {
  const stamp = Date.now();
  return {
    orgName: `一周の工務店 ${stamp}`,
    adminEmail: `journey-admin-${stamp}@example.test`,
    memberEmail: `journey-member-${stamp}@example.test`,
    projectName: `現場 ${stamp}`,
    secretPlace: "35.6266,139.7236",
  };
}

// ── 1. 事前登録(公開の LP から送られる物を直接送る)→ 確認のメール → 確認 ──
async function preRegister(request: APIRequestContext, c: Company): Promise<string> {
  const res = await request.post("/api/public/pre-registrations", {
    data: {
      email: c.adminEmail,
      organizationName: c.orgName,
      companySize: "1-9",
      consent: true,
      consentTextVersion: currentPreRegistrationConsent().version,
      utmSource: "journey",
      utmMedium: "e2e",
      utmCampaign: "g-119",
      landingPath: "/",
    },
  });
  expect(res.status()).toBe(204);
  const pattern = /\/confirm#t=(\S+)/;
  await expect.poll(() => linkIn(c.adminEmail, pattern), { timeout: 15_000 }).not.toBeNull();
  const token = ((await linkIn(c.adminEmail, pattern)) as string).replace(/^.*#t=/, "");
  const confirm = await request.post("/api/public/pre-registrations/confirm", {
    data: { token },
  });
  expect(confirm.status()).toBe(204);
  // 本番では、営業・CS が本人とのやり取りでどの登録かを決め、開発が ID だけを受け取る(tenant-provisioning.md)。
  // ここでは確認のリンクの token の頭(`<登録の ID>.<署名>`)から取る
  return token.split(".")[0] as string;
}

// ── 2. 開通(運営が申し込みの JSON から組織を作る。試し → 本当に作る)→ 開通の案内のメール ──
async function openTenant(dir: string, c: Company, preRegistrationId: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  // 会社名と管理者のメールは事前登録から埋まる(会社名は --confirm-name に読み上げるので書いておく)
  writeFileSync(
    `${dir}/application.json`,
    JSON.stringify({ name: c.orgName, admin: { name: "一周 太郎" }, startDate: "2026-11-01" }),
  );
  const args = [
    "create-tenant",
    "/journey/application.json",
    "--from-pre-registration",
    preRegistrationId,
  ];
  const plan = operator(args, { mount: dir });
  expect(plan).toMatchObject({ mode: "plan", preRegistrationId, ignoredKeys: ["startDate"] });
  const created = operator([...args, "--execute", "--confirm-name", c.orgName], { mount: dir });
  expect(created).toMatchObject({ mode: "created", preRegistrationId });
  await expect
    .poll(async () => (await mailsTo(c.adminEmail)).map((m) => m.Subject), { timeout: 15_000 })
    .toContain(`${c.orgName} のご利用の準備ができました`);
  return created.tenantId as string;
}

// ── 4. 招待(管理者が画面から招く → メールのリンク → 参加 → ログイン)──
async function inviteMember(admin: Page, browser: Browser, c: Company): Promise<Page> {
  await admin.getByRole("link", { name: "設定" }).click();
  await admin.getByRole("link", { name: "招待を開く" }).click();
  await admin.getByLabel("招く人のメールアドレス").fill(c.memberEmail);
  await admin.getByRole("button", { name: "招く" }).click();
  const pattern = /https?:\/\/\S+\/invitation#\S+/;
  await expect.poll(() => linkIn(c.memberEmail, pattern), { timeout: 15_000 }).not.toBeNull();
  const link = new URL((await linkIn(c.memberEmail, pattern)) as string);
  const member = await (await browser.newContext()).newPage();
  await member.goto(link.pathname + link.hash);
  await member.getByLabel("名前").fill("一周 花子");
  await member.getByRole("button", { name: "参加する" }).click();
  await expect(member.getByText(`${c.orgName} に参加しました。`)).toBeVisible();
  await logIn(member, c.memberEmail, "member");
  return member;
}

// ── 5. 機能(題材の TODO)と写真(画面はまだ無いので API で)。写真の見る URL を返す ──
async function useWithPhoto(member: Page, c: Company): Promise<string> {
  await member.getByLabel("新しいプロジェクトの名前").fill(c.projectName);
  await member.getByRole("button", { name: "作る" }).click();
  await member.getByRole("link", { name: c.projectName }).click();
  await member.getByLabel("新しいタスク").fill("基礎の写真を撮る");
  await member.getByRole("button", { name: "足す" }).click();
  await expect(member.getByRole("checkbox", { name: "基礎の写真を撮る" })).toBeVisible();

  const { projects } = await getJson<{ projects: { id: string; name: string }[] }>(
    member.request,
    "/api/projects",
  );
  const projectId = projects.find((p) => p.name === c.projectName)?.id;
  const { tasks } = await getJson<{ tasks: { id: string }[] }>(
    member.request,
    `/api/projects/${projectId}/tasks`,
  );

  notYet(
    "G-45 の画面",
    "タスクの画面のファイルの欄(題材を差し替えるときに作る。ここでは API で上げる)",
  );
  const photo = pngWithText(c.secretPlace);
  const created = await member.request.post(`/api/tasks/${tasks[0]?.id}/files`, {
    data: { name: "基礎.png", contentType: "image/png", byteSize: photo.length },
  });
  expect(created.status()).toBe(201);
  const file = (await created.json()) as {
    id: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await fetch(file.upload.url, {
    method: "PUT",
    headers: file.upload.headers,
    body: new Uint8Array(photo),
  });
  expect(put.status).toBe(200);
  // 本文の無い POST は、ブラウザと同じく Origin を付ける(付けないと API の CSRF の守りが 403 で断る)
  const complete = await member.request.post(`/api/files/${file.id}/complete`, {
    headers: { origin: new URL(member.url()).origin },
  });
  expect(complete.status()).toBe(202);

  // 中身を確かめて ready になるまで(アウトボックスの受け手が付いた情報を外す)
  const fileOf = () =>
    getJson<{ status: string; downloadUrl?: string }>(member.request, `/api/files/${file.id}`);
  await expect.poll(async () => (await fileOf()).status, { timeout: 20_000 }).toBe("ready");
  const downloadUrl = (await fileOf()).downloadUrl as string;
  const body = Buffer.from(await (await fetch(downloadUrl)).arrayBuffer());
  expect(body.subarray(0, 8)).toEqual(photo.subarray(0, 8));
  expect(body.toString("latin1")).not.toContain(c.secretPlace);
  return downloadUrl;
}

// ── 7. 書き出し(管理者が設定から JSON を受け取る)──
async function exportData(admin: Page, saveAs: (name: string) => string, c: Company) {
  await admin.getByRole("link", { name: "設定" }).click();
  const [file] = await Promise.all([
    admin.waitForEvent("download"),
    admin.getByRole("button", { name: "書き出す" }).click(),
  ]);
  // CI は Docker の中のブラウザにつなぐので、手元に写してから読む(export.spec.ts と同じ)
  const saved = saveAs(file.suggestedFilename());
  await file.saveAs(saved);
  const text = readFileSync(saved, "utf8");
  expect(JSON.parse(text)).toMatchObject({ organization: { name: c.orgName } });
  expect(text).toContain(c.projectName);
  expect(text).toContain("基礎.png");
  expect(text).not.toContain("Acme");
}

// ── 10. 解約(運営が組織を消す。試し → 本当に消す)→ 誰も入れず、写真も消える ──
async function closeTenant(
  tenantId: string,
  c: Company,
  sessions: { admin: Page; member: Page; request: APIRequestContext },
  photoUrl: string,
) {
  const plan = operator(["delete-tenant", tenantId]);
  expect(plan).toMatchObject({ mode: "plan", tenantId });
  expect(plan.objects).not.toBeNull();
  const done = operator(["delete-tenant", tenantId, "--execute", "--confirm-name", c.orgName]);
  expect(done).toMatchObject({ mode: "deleted", tenantId });

  // ログインしていた人も、次の呼び出しで外れる
  expect((await sessions.member.request.get("/api/me")).status()).toBe(401);
  expect((await sessions.admin.request.get("/api/me")).status()).toBe(401);
  // もう一度ログインしようとしても入れない
  const again = await sessions.request.post("/api/auth/dev-login", {
    data: { email: c.adminEmail },
  });
  expect(again.ok()).toBe(false);
  // 前に受け取った写真の URL(期限内)でも、中身はもう無い
  expect((await fetch(photoUrl)).ok).toBe(false);
}

test.beforeEach(async () => {
  const mailpit = await fetch(`${MAILPIT}/livez`)
    .then((r) => r.ok)
    .catch(() => false);
  test.skip(
    !mailpit || !operatorAvailable(),
    "docker compose で立てたときだけ(運営のコマンドとメール)",
  );
});

test("1つの会社が、事前登録から解約まで一周できる", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const c = newCompany();

  const preRegistrationId = await test.step("1. 事前登録して、確認のメールのリンクを開く", () =>
    preRegister(request, c));
  const tenantId = await test.step("2. 運営が事前登録から組織を作り、開通の案内が届く", () =>
    openTenant(testInfo.outputPath("applications"), c, preRegistrationId));
  await test.step("3. 最初の管理者がログインし、組織を代表して利用規約に同意する", async () => {
    await logIn(page, c.adminEmail, "admin");
    const me = await getJson<Record<string, unknown>>(page.request, "/api/me");
    expect(me).toMatchObject({ email: c.adminEmail, tenantName: c.orgName, role: "admin" });
    await expectAccessible(page);
  });
  const member = await test.step("4. 管理者が職人を招き、職人が参加してログインする", () =>
    inviteMember(page, browser, c));
  const memberMe = await getJson<{ userId: string; role: string }>(member.request, "/api/me");
  expect(memberMe.role).toBe("member");
  const photoUrl =
    await test.step("5. 職人がタスクを作り、現場の写真を上げる(位置情報は外れる)", () =>
      useWithPhoto(member, c));
  await test.step("6. 運営がプランを入れ、管理者から見える", async () => {
    operator(["plan", tenantId, "--plan", "standard", "--seats", "3", "--execute"]);
    const seen = await getJson<Record<string, unknown>>(page.request, "/api/organization/plan");
    expect(seen).toMatchObject({
      plan: { id: "standard", seats: 3 },
      members: 2,
      pendingInvitations: 0,
    });
  });
  await test.step("7. 管理者が自社のデータを書き出す(写真は名前だけ・他社の物は入らない)", () =>
    exportData(page, (name) => testInfo.outputPath(name), c));
  await test.step("8. 管理者が辞めた職人を外す", async () => {
    notYet("G-103", "お客さんの管理者が人を外す・無効にする・ロールを変える画面と API");
  });
  await test.step("9. 運営が1人分のデータを数える(削除はまだ手で)", async () => {
    const plan = operator(["person-data", tenantId, memberMe.userId]);
    expect(plan).toMatchObject({ mode: "plan", found: true });
    notYet("G-06 の残り", "1人分の削除のコマンド(今は docs/runbooks/person-data.md の手順で手で)");
  });
  await test.step("10. 運営が組織を消し、誰も入れず、写真も消える", () =>
    closeTenant(tenantId, c, { admin: page, member, request }, photoUrl));
});
