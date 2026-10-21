import { LEGAL_DOCUMENT_TITLES, type Me } from "@app/shared";
import { Alert, Button, Card, Checkbox, Heading, Link, List, Muted, Stack, Text } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api.ts";
import { formatDateTime } from "../format.ts";
import { acceptItems, agreesForOrganization } from "../legal/accept.ts";
import { useAction } from "../use-action.ts";

// 同意の画面(docs/specs/0008-legal-consent.md)。同意し直しが要る版に同意していない人は、どの画面を開いてもここへ回される
// (守りは API の関所。403 terms_acceptance_required)。帯の「前もって同意する」からも来る。
// 同意しない人はログアウトだけできる(画面の上のボタン)。

export function LegalAcceptPage({ me, returnTo }: { me: Me; returnTo: string }) {
  const router = useRouter();
  const accepting = useAction();
  const [checked, setChecked] = useState(false);
  const items = acceptItems(me);
  const required = items.some((i) => i.required);

  if (items.length === 0) {
    return (
      <Card>
        <Stack gap={4}>
          <Heading level={1}>利用規約などへの同意</Heading>
          <Text>いま同意をお願いしている物はありません。</Text>
          <Link href={returnTo}>元の画面へ</Link>
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <Stack gap={4}>
        <Heading level={1}>利用規約などへの同意</Heading>
        <Text>
          {required
            ? "続けて使うには、次の内容への同意が必要です。変更の要約と本文を確かめてください。"
            : "次の内容が変わります。効力の日の前に、ここで同意しておくこともできます。"}
        </Text>
        <List label="同意をお願いしている文書">
          {items.map((item) => (
            <li key={item.document}>
              <Stack gap={1}>
                <strong>
                  {LEGAL_DOCUMENT_TITLES[item.document]}(版 {item.version}・
                  {formatDateTime(new Date(item.effectiveAt).toISOString(), me.timeZone)} から)
                </strong>
                <Muted>変更の要約: {item.summary}</Muted>
                <Link
                  href={`/legal/${item.document}/${item.version}`}
                  target="_blank"
                  rel="noopener"
                >
                  {LEGAL_DOCUMENT_TITLES[item.document]}の本文を読む(新しいタブ)
                </Link>
              </Stack>
            </li>
          ))}
        </List>
        <Checkbox isSelected={checked} onChange={setChecked} strikeWhenSelected={false}>
          {agreesForOrganization(me, items)
            ? "上の内容を確かめ、組織を代表して同意します"
            : "上の内容を確かめ、同意します"}
        </Checkbox>
        <div>
          <Button
            isDisabled={!checked || accepting.pending}
            onPress={async () => {
              const consents = items.map(({ document, version }) => ({ document, version }));
              const done = await accepting.run(() => api.acceptLegal(consents), {
                success: "同意を記録しました",
              });
              if (done) await router.navigate({ href: returnTo });
            }}
          >
            同意する
          </Button>
        </div>
        {required ? (
          <Alert tone="info">
            同意しない場合は、画面の上の「ログアウト」から終えてください。契約については、組織の管理者に相談してください。
          </Alert>
        ) : null}
      </Stack>
    </Card>
  );
}
