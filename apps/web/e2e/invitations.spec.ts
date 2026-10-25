import { type Browser, expect, type Page, test } from "@playwright/test";
import { expectAccessible, loginAs } from "./helpers.ts";

// 招待(docs/specs/0027-invitations.md): 管理者が画面から招く → メールのリンク → 名前を入れて参加 →
// そのメールでログインすると、その組織に入る。リンクは1回きり。取り消した招待は受けられない。
// メールは docker compose の本番と同じ道(API → Postfix → Mailpit)。Mailpit が無い所では飛ばす。
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

type Message = { ID: string };

async function invitationLink(address: string): Promise<string | null> {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  const [message] = ((await res.json()) as { messages: Message[] }).messages;
  if (!message) return null;
  const body = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
    Text: string;
  };
  return body.Text.match(/https?:\/\/\S+\/invitation#\S+/)?.[0] ?? null;
}

async function invite(page: Page, email: string) {
  await page.getByLabel("招く人のメールアドレス").fill(email);
  await page.getByRole("button", { name: "招く" }).click();
  await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("受けていない");
}

/** リンクを、ログインしていない別のブラウザで開いて受ける */
async function acceptIn(browser: Browser, link: string, name: string) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(new URL(link).pathname + new URL(link).hash);
  await expect(guest.getByRole("heading", { name: "招待を受ける" })).toBeVisible();
  await guest.getByLabel("名前").fill(name);
  await guest.getByRole("button", { name: "参加する" }).click();
  return guest;
}

test.beforeEach(async () => {
  const available = await fetch(`${MAILPIT}/livez`)
    .then((r) => r.ok)
    .catch(() => false);
  test.skip(!available, "Mailpit が無い(docker compose 以外)");
});

test("管理者が招き、招かれた人がリンクから参加して、その組織に入る(リンクは1回きり)", async ({
  page,
  browser,
}) => {
  const email = `invited-${Date.now()}@example.test`;
  await loginAs(page, "admin@acme.test");
  await page.getByRole("link", { name: "設定" }).click();
  await page.getByRole("link", { name: "招待を開く" }).click();
  await expect(page.getByRole("heading", { name: "招待", level: 1 })).toBeVisible();
  await invite(page, email);
  await expectAccessible(page);

  // 送り出しは1秒ごと。Postfix を通って Mailpit に届くまで待つ
  await expect.poll(() => invitationLink(email), { timeout: 15_000 }).not.toBeNull();
  const link = (await invitationLink(email)) as string;

  const guest = await acceptIn(browser, link, "招かれた 人");
  await expect(guest.getByText("Acme 株式会社 に参加しました。")).toBeVisible();
  await expect(guest.getByText(`(${email})`)).toBeVisible();
  // 札は URL から消える(履歴・画面の写しに残さない)
  expect(guest.url()).not.toContain("#");
  await expectAccessible(guest);

  // そのメールでログインすると、同意の画面 → その組織のプロジェクト
  await guest.getByRole("link", { name: "ログインする" }).click();
  await guest.getByLabel("メールアドレス").fill(email);
  await guest.getByRole("button", { name: "ログイン" }).click();
  await guest.getByText("上の内容を確かめ、同意します").click();
  await guest.getByRole("button", { name: "同意する" }).click();
  await expect(guest.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
  const me = await guest.evaluate(async () => (await fetch("/api/me")).json());
  expect(me).toMatchObject({ email, tenantName: "Acme 株式会社", role: "member" });

  // 管理者の一覧では「参加した」
  await page.reload();
  await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("参加した");

  // 同じリンクは2回使えない
  const again = await acceptIn(browser, link, "別の 人");
  await expect(again.getByRole("alert")).toContainText("もう使われています");
});

test("取り消した招待のリンクは使えない", async ({ page, browser }) => {
  const email = `revoked-${Date.now()}@example.test`;
  await loginAs(page, "admin@acme.test");
  await page.goto("/invitations");
  await invite(page, email);
  await expect.poll(() => invitationLink(email), { timeout: 15_000 }).not.toBeNull();
  const link = (await invitationLink(email)) as string;

  const row = page.getByRole("row", { name: new RegExp(email) });
  await row.getByRole("button", { name: "取り消す" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "取り消す" }).click();
  await expect(row).toContainText("取り消し済み");

  const guest = await acceptIn(browser, link, "誰か");
  await expect(guest.getByRole("alert")).toContainText("招待のリンクが正しくないか");
});
