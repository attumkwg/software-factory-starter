import { Button, Heading, Link, Muted, Page, Stack } from "@app/ui";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { describeError } from "../errors.ts";
import { reportBrowserError } from "../report-error.ts";

// 画面を読むときの失敗の受け皿(router.tsx の defaultErrorComponent)。中身(スタックや SQL)は見せない。
// 問い合わせのときに使えるよう、API の request ID があれば出す。「もう一度読み込む」で、その画面だけを読み直す。
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const { message, requestId } = describeError(error);
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
