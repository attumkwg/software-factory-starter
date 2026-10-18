import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers.ts";

// タスク完了のメール(docs/specs/0002-task-completed-mail.md)。docker compose の本番と同じ道
// (API → Postfix → 手元は Mailpit)で届くかを、Mailpit の API で確かめる。
// Mailpit が無い所(PR のプレビュー環境など)では飛ばす。
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

type Message = { Subject: string; To: { Address: string }[]; ID: string };

async function mailsTo(address: string): Promise<Message[]> {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  return ((await res.json()) as { messages: Message[] }).messages;
}

test("管理者が作ったプロジェクトのタスクをメンバーが完了にすると、管理者にメールが届く", async ({
  page,
  browser,
}) => {
  const available = await fetch(`${MAILPIT}/livez`)
    .then((r) => r.ok)
    .catch(() => false);
  test.skip(!available, "Mailpit が無い(docker compose 以外)");

  const projectName = `メールの確認 ${Date.now()}`;
  const taskTitle = `報告を書く ${Date.now()}`;

  // 管理者がプロジェクトとタスクを作る
  await loginAs(page, "admin@acme.test");
  await page.getByLabel("新しいプロジェクトの名前").fill(projectName);
  await page.getByRole("button", { name: "作る" }).click();
  await page.getByRole("link", { name: projectName }).click();
  await page.getByLabel("新しいタスク").fill(taskTitle);
  await page.getByRole("button", { name: "足す" }).click();
  const projectUrl = page.url();

  // メンバーが完了にする(別のブラウザの文脈 = 別の人)
  const member = await (await browser.newContext()).newPage();
  await loginAs(member, "member@acme.test");
  await member.goto(projectUrl);
  await member.getByText(taskTitle, { exact: true }).click();
  await expect(member.getByRole("checkbox", { name: taskTitle })).toBeChecked();

  // 送り出しは1秒ごと。Postfix を通って Mailpit に届くまで待つ
  await expect
    .poll(async () => (await mailsTo("admin@acme.test")).map((m) => m.Subject), { timeout: 15_000 })
    .toContain(`タスク「${taskTitle}」が完了しました`);
});
