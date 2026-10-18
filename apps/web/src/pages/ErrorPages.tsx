import { Heading, Muted, Page, Stack } from "@app/ui";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { HttpError } from "../api.ts";

// 想定していない失敗の受け皿(router.tsx の defaultErrorComponent)。中身(スタックや SQL)は見せない。
// 問い合わせのときに使えるよう、API の request ID があれば出す。
export function ErrorPage({ error }: ErrorComponentProps) {
  const requestId = error instanceof HttpError ? error.body?.error.requestId : undefined;
  return (
    <Page>
      <main>
        <Stack gap={2}>
          <Heading level={1}>うまく表示できませんでした</Heading>
          <Muted>時間をおいて、もう一度開いてください。</Muted>
          {requestId && <Muted>問い合わせ番号: {requestId}</Muted>}
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
        </Stack>
      </main>
    </Page>
  );
}
