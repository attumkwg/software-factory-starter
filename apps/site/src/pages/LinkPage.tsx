import { Alert, Button, Heading, Inline, Page, Stack, Text } from "@app/ui";
import { useEffect, useState } from "react";
import { postPublic } from "../api.ts";
import type { SiteConfig } from "../config.ts";
import { CONTENT } from "../content.ts";
import { tokenFromHash } from "../source.ts";

// 確認のメールのリンクから開くページ(/confirm/・/withdraw/)。token は URL の # の後ろ(サーバーのログに残らない)。
// 確認は開いたら送る。取り消しはボタンを押してから送る(メールの道具の先読みで消えないように)。

type State = "waiting" | "sending" | "done" | "invalid" | "failed";

export function ConfirmPage({ config }: { config: SiteConfig }) {
  const [state, setState] = useState<State>("waiting");
  useEffect(() => {
    const token = tokenFromHash(window.location.hash);
    if (!token) {
      setState("invalid");
      return;
    }
    setState("sending");
    void postPublic(config.appUrl, "pre-registrations/confirm", { token }).then((r) =>
      setState(r === "ok" ? "done" : r === "bad_request" ? "invalid" : "failed"),
    );
  }, [config.appUrl]);
  return (
    <Page>
      <Stack gap={4}>
        <Heading level={1}>事前登録の確認</Heading>
        {(state === "waiting" || state === "sending") && <Text>確かめています…</Text>}
        {state === "done" && (
          <Alert tone="info">
            確かめました。{CONTENT.productName}の提供開始のご案内をお送りします。
          </Alert>
        )}
        {state === "invalid" && (
          <Alert>
            リンクの期限が切れたか、使えないリンクです。お手数ですが、もう一度登録してください。
          </Alert>
        )}
        {state === "failed" && (
          <Alert>確かめられませんでした。時間をおいて、もう一度開いてください。</Alert>
        )}
        <Text>
          <a href={`${config.siteUrl}/`} className="ui-link ui-link--inline">
            {CONTENT.productName}のページへ
          </a>
        </Text>
      </Stack>
    </Page>
  );
}

export function WithdrawPage({ config }: { config: SiteConfig }) {
  const [state, setState] = useState<State>("waiting");
  const withdraw = async () => {
    const token = tokenFromHash(window.location.hash);
    if (!token) {
      setState("invalid");
      return;
    }
    setState("sending");
    const r = await postPublic(config.appUrl, "pre-registrations/withdraw", { token });
    setState(r === "ok" ? "done" : r === "bad_request" ? "invalid" : "failed");
  };
  return (
    <Page>
      <Stack gap={4}>
        <Heading level={1}>事前登録を消す</Heading>
        {state === "done" ? (
          <Alert tone="info">消しました。ご案内はお送りしません。</Alert>
        ) : (
          <>
            <Text>登録した会社名とメールアドレスを消します。消すと、ご案内はお送りしません。</Text>
            {state === "invalid" && (
              <Alert>使えないリンクです。メールのリンクから開き直してください。</Alert>
            )}
            {state === "failed" && (
              <Alert>消せませんでした。時間をおいて、もう一度お試しください。</Alert>
            )}
            <Inline>
              <Button variant="danger" isDisabled={state === "sending"} onPress={withdraw}>
                登録を消す
              </Button>
            </Inline>
          </>
        )}
      </Stack>
    </Page>
  );
}
