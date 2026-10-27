import { test as base, expect } from "@playwright/test";

/**
 * PR の動作確認(/verify-pr。e2e/verify/)の土台。「通った」を「確かめた」と取り違えないための記録を取る。
 * - 画面のエラー(pageerror)と、サーバーの失敗(5xx)があれば、確認が通っていても落とす(エラーの放置)
 * - console のエラーと 4xx の通信は落とさずに記録する(権限の確かめでは 403・404 が正しい)
 * API の直叩き(page.request など)は記録に出ないので、pnpm verify:lint が書き方で止め、AI がトレースで確かめる
 * 記録は報告に「verify-log」として付く。AI は通った後もこれとトレースを読む(2層目。docs/guides/verify-pr.md)
 */
type VerifyLog = {
  pageErrors: string[];
  consoleErrors: string[];
  failedResponses: { status: number; method: string; path: string }[];
};

// 記録に URL の問い合わせ(?以降)を残さない(トークン・個人データが載りうる)
const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "(読めない URL)";
  }
};

export const test = base.extend<{ verifyLog: VerifyLog }>({
  verifyLog: [
    async ({ page }, use, testInfo) => {
      const log: VerifyLog = {
        pageErrors: [],
        consoleErrors: [],
        failedResponses: [],
      };
      page.on("pageerror", (e) => log.pageErrors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") log.consoleErrors.push(m.text());
      });
      page.on("response", (r) => {
        if (r.status() >= 400)
          log.failedResponses.push({
            status: r.status(),
            method: r.request().method(),
            path: pathOf(r.url()),
          });
      });
      await use(log);
      await testInfo.attach("verify-log", {
        body: JSON.stringify(log, null, 2),
        contentType: "application/json",
      });
      expect(log.pageErrors, "画面のエラーが出ている(エラーの放置)").toEqual([]);
      expect(
        log.failedResponses.filter((r) => r.status >= 500),
        "サーバーが失敗している(エラーの放置)",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
