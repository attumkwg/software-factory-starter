import { connect } from "node:net";

// 偽物の Cognito が確認コードのメールを送る、最小の SMTP の送り手(依存を増やさないため手で書く)。
// 手元では Postfix(docker compose)に渡し、Mailpit で読める。本物の Cognito は SES から送る。
// TLS・認証は無し(compose の中だけで使う)。**本番では使わない**。

export type Mail = { to: string; subject: string; text: string };
export type SendMail = (mail: Mail) => Promise<void>;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export function sendMailViaSmtp(smtpUrl: string, from: string): SendMail {
  const url = new URL(smtpUrl);
  const host = url.hostname;
  const port = Number(url.port || 25);

  return (mail) =>
    new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      socket.setEncoding("utf8");
      socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP の応答が時間内にありません")));

      const body = [
        `From: ${from}`,
        `To: ${mail.to}`,
        `Subject: =?UTF-8?B?${b64(mail.subject)}?=`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        `Date: ${new Date().toUTCString()}`,
        "",
        ...(b64(mail.text).match(/.{1,76}/g) ?? []),
      ].join("\r\n");
      const address = (s: string) => s.match(/<([^>]+)>/)?.[1] ?? s;
      // 送る順番。それぞれ、相手の返事のコードが合っていれば次へ
      const steps: [string | null, string][] = [
        [null, "220"],
        [`EHLO fake-cognito`, "250"],
        [`MAIL FROM:<${address(from)}>`, "250"],
        [`RCPT TO:<${mail.to}>`, "250"],
        ["DATA", "354"],
        [`${body}\r\n.`, "250"],
        ["QUIT", "221"],
      ];
      let step = 0;
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        // 複数行の返事("250-…")は、最後の行("250 …")まで待つ
        const lines = buffer.split("\r\n").filter(Boolean);
        const last = lines.at(-1) ?? "";
        if (!buffer.endsWith("\r\n") || /^\d{3}-/.test(last)) return;
        buffer = "";
        const expected = steps[step]?.[1];
        if (!last.startsWith(expected ?? "")) {
          socket.destroy(new Error(`SMTP が断りました: ${last.slice(0, 3)}`));
          return;
        }
        step += 1;
        const next = steps[step];
        if (!next) {
          socket.end();
          return;
        }
        socket.write(`${next[0]}\r\n`);
      });
      socket.on("error", reject);
      socket.on("close", () =>
        step >= steps.length ? resolve() : reject(new Error("SMTP が途中で切れました")),
      );
    });
}
