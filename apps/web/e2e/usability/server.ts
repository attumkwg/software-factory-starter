// 初見の利用者テストのブラウザを持ち続けるサーバー(仕様 0100)。browse.ts の start が裏で立てる。
// ブラウザは E2E と同じ Docker の中の Chromium(docker-compose.vrt.yml・ws://127.0.0.1:3100/)。ホストに入れない。
// 待ち受けは 127.0.0.1 だけ。行き先は UX_BASE_URL(既定 http://localhost:8080)の中だけ。
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium, devices, type Locator, type Page } from "@playwright/test";
import { roleOf, type Step, sameOrigin } from "./browse-lib.ts";

const dir = process.env.UX_DIR ?? "";
const base = process.env.UX_BASE_URL ?? "http://localhost:8080";
const device = process.env.UX_DEVICE === "desktop" ? devices["Desktop Chrome"] : devices["Pixel 7"];
const touch = process.env.UX_DEVICE !== "desktop";
const ws = process.env.E2E_WS_ENDPOINT ?? "ws://127.0.0.1:3100/";

const browser = await chromium.connect(ws, { exposeNetwork: "<loopback>" });
const context = await browser.newContext({ ...device, baseURL: base, locale: "ja-JP" });
const page: Page = await context.newPage();
await page.goto(base);
let shots = 0;

const record = (step: Omit<Step, "at" | "url">) =>
  appendFileSync(
    join(dir, "steps.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), url: page.url(), ...step })}\n`,
  );

/**
 * 押した後、画面が落ち着くまで待つ。通信が止んでも、画面の書き換え(ルーターの移動・読み直し)はその後に来るので、
 * 見える物の木が 250ms あけて2回同じになるまで待つ(最長 3秒)。待たないと「押したのに前の画面のまま」に見え、
 * 利用者役が道具の遅れを迷いとして書いてしまう(2026-11-14 の U-4)
 */
async function settle() {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  let before = "";
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    const now = await page
      .locator("body")
      .ariaSnapshot()
      .catch(() => "");
    if (now === before) return;
    before = now;
  }
}

/** 見えている物を、役割と名前で(画面に出ている言葉だけ) */
async function look() {
  shots += 1;
  const shot = join(dir, `shot-${String(shots).padStart(2, "0")}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  const tree = await page.locator("body").ariaSnapshot();
  return `画面: ${await page.title()}\nURL: ${new URL(page.url()).pathname}\n画像: ${shot}\n---\n${tree}`;
}

/** 役割と名前で1つに絞る。ちょうど同じ名前を先に、無ければ名前を含む物 */
async function target(role: string, name: string): Promise<Locator> {
  const r = roleOf(role) as Parameters<Page["getByRole"]>[0];
  const exact = page.getByRole(r, { name, exact: true });
  if ((await exact.count()) === 1) return exact;
  const loose = page.getByRole(r, { name });
  const n = await loose.count();
  if (n === 1) return loose;
  if (n === 0) throw new Error(`「${name}」という ${role} は見当たりません`);
  throw new Error(`「${name}」を含む ${role} が ${n} 個あります。もっと長い名前で`);
}

async function run(action: string, args: string[]): Promise<string> {
  switch (action) {
    case "look":
      return look();
    case "tap": {
      const [role = "", ...rest] = args;
      let el = await target(role, rest.join(" "));
      // チェックの本体(input)は見えないように置かれる。人が押すのは四角と文字(ラベル)なので、ラベルを押す
      const label = page.locator("label").filter({ has: el });
      if ((await label.count()) === 1) el = label;
      if (touch) await el.tap({ timeout: 5000 });
      else await el.click({ timeout: 5000 });
      break;
    }
    case "fill": {
      const [label = "", ...rest] = args;
      await page.getByLabel(label).first().fill(rest.join(" "), { timeout: 5000 });
      break;
    }
    case "select": {
      const [label = "", ...rest] = args;
      const box = page.getByRole("combobox", { name: label }).or(page.getByLabel(label)).first();
      if (touch) await box.tap({ timeout: 5000 });
      else await box.click({ timeout: 5000 });
      const option = page.getByRole("option", { name: rest.join(" "), exact: true });
      if (touch) await option.tap({ timeout: 5000 });
      else await option.click({ timeout: 5000 });
      break;
    }
    case "press":
      await page.keyboard.press(args[0] ?? "Enter");
      break;
    case "goto": {
      const to = sameOrigin(base, args[0] ?? "/");
      if (!to) throw new Error("このアプリの外へは行けません");
      await page.goto(to);
      break;
    }
    case "back":
      await page.goBack();
      break;
    default:
      throw new Error(`知らない操作: ${action}`);
  }
  await settle();
  return look();
}

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const { action, args } = JSON.parse(body || "{}") as { action: string; args: string[] };
  if (action === "stop") {
    res.end("終えました");
    await browser.close();
    server.close();
    return;
  }
  try {
    const out = await run(action, args ?? []);
    if (action !== "look") record({ action, args, ok: true });
    res.end(out);
  } catch (e) {
    const error = e instanceof Error ? e.message.split("\n")[0] : String(e);
    record({ action, args, ok: false, error });
    res.statusCode = 422;
    res.end(`できませんでした: ${error}`);
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  writeFileSync(join(dir, "server.json"), JSON.stringify({ port, pid: process.pid }));
});
