import { Card, Heading, List, Muted, Page, Stack, Text } from "@app/ui";
import { useEffect } from "react";
import { postPublic } from "../api.ts";
import type { SiteConfig } from "../config.ts";
import { CONTENT } from "../content.ts";
import { sourceFromSearch } from "../source.ts";
import { SignUpForm } from "./SignUpForm.tsx";

// LP の本体(見出し・困りごと・解決・値段・事前登録・運営者とプライバシーポリシー)。言葉は content.ts。

/** 開いて1秒たったら、見た数に1足す(機械の先読みを減らす。Cookie も端末の ID も送らない) */
function useCountView(config: SiteConfig) {
  useEffect(() => {
    const timer = setTimeout(() => {
      void postPublic(config.appUrl, "lp-views", {
        path: window.location.pathname,
        ...sourceFromSearch(window.location.search),
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [config.appUrl]);
}

function Section({
  title,
  items,
  label,
}: {
  title: string;
  items: readonly string[];
  label: string;
}) {
  return (
    <Stack gap={2}>
      <Heading level={2}>{title}</Heading>
      <List label={label}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </List>
    </Stack>
  );
}

export function Landing({ config }: { config: SiteConfig }) {
  useCountView(config);
  return (
    <Page>
      <Stack gap={6}>
        <Stack gap={2}>
          <Muted>{CONTENT.productName}</Muted>
          <Heading level={1}>{CONTENT.hero.title}</Heading>
          <Text>{CONTENT.hero.lead}</Text>
        </Stack>
        <Section title="こんなことで困っていませんか" items={CONTENT.problems} label="困りごと" />
        <Section
          title={`${CONTENT.productName}でできること`}
          items={CONTENT.solutions}
          label="できること"
        />
        <Stack gap={2}>
          <Heading level={2}>値段</Heading>
          <Text>{CONTENT.price ?? "提供開始の前にお知らせします。"}</Text>
        </Stack>
        <Card>
          <Stack gap={3}>
            <Heading level={2}>事前登録</Heading>
            <Text>提供開始のご案内と、試しの利用のご招待をお送りします。</Text>
            <SignUpForm config={config} />
          </Stack>
        </Card>
        <Muted>
          運営: {CONTENT.operator.name}・お問い合わせ: {CONTENT.operator.contact}・
          <a href={`${config.appUrl}/legal/privacy`} className="ui-link ui-link--inline">
            プライバシーポリシー
          </a>
        </Muted>
      </Stack>
    </Page>
  );
}
