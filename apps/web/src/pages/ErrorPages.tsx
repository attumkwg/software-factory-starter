import { Button, Heading, Link, Muted, Page, Stack } from "@app/ui";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { describeError } from "../errors.ts";
import { reportBrowserError } from "../report-error.ts";
import { isRefusal, markRefusal } from "../ssr-status.ts";

// 画面を読むときの失敗の受け皿(router.tsx の defaultErrorComponent)。中身(スタックや SQL)は見せない。
// 問い合わせのときに使えるよう、API の request ID があれば出す。「もう一度読み込む」で、その画面だけを読み直す。
// API の断り(権限が無い・無い物・形が変)なら、読み直しても変わらないので「最初の画面へ」も出す(行き止まりにしない)。
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const { message, requestId } = describeError(error);
  const refusal = isRefusal(error);
  // 応答の番号を、500 でなくその断りの番号にする(サーバーで描くときだけ。#186・src/ssr-status.ts)
  if (refusal) markRefusal(error.status);
  // こちらのバグなら Sentry へ(API・通信・SSR の失敗は、ほかで記録済みなので送らない)
  useEffect(() => reportBrowserError(error), [error]);
  return (
    <Page>
      <main>
        <Stack gap={4}>
          <Heading level={1}>うまく表示できませんでした</Heading>
          <Muted>{message}</Muted>
          {requestId && <Muted>問い合わせ番号: {requestId}</Muted>}
          <div>
            <Button
              variant="primary"
              onPress={async () => {
                await router.invalidate();
                reset();
              }}
            >
              もう一度読み込む
            </Button>
          </div>
          {refusal && <Link href="/">最初の画面へ</Link>}
        </Stack>
      </main>
    </Page>
  );
}

export function NotFoundPage() {
  return (
    <Page>
      <main>
        <Stack gap={2}>
          <Heading level={1}>ページが見つかりません</Heading>
          <Muted>URL を確かめてください。</Muted>
          {/* 戻る先が無いと行き止まりになる(ログイン前ならログインの画面へ回る) */}
          <Link href="/">最初の画面へ</Link>
        </Stack>
      </main>
    </Page>
  );
}
