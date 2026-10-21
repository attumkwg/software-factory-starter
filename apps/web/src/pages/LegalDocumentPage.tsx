import { DEFAULT_TIME_ZONE, LEGAL_DOCUMENT_TITLES, type LegalVersion } from "@app/shared";
import { Alert, Card, Heading, Link, List, Muted, Page, Stack, Text } from "@app/ui";
import { formatDateTime } from "../format.ts";
import { parseMarkdown } from "../legal/markdown.ts";

// 規約の本文の画面(ログイン無しで読める。docs/specs/0008-legal-consent.md)。
// 上に文書の名前・版・効力の日、本文、下に変更の履歴。時刻は組織が分からないので既定の時間帯(日本)で出す。

export type LegalDocumentView = {
  version: LegalVersion;
  body: string;
  /** その文書の公開済みの版(古い順) */
  history: LegalVersion[];
  /** いま効いている版の番号 */
  currentVersion: number | undefined;
};

const at = (iso: string) => formatDateTime(new Date(iso).toISOString(), DEFAULT_TIME_ZONE);

function statusOf(v: LegalVersion, current: number | undefined): string {
  if (v.version === current) return "いまの版";
  if (current !== undefined && v.version < current) return "前の版";
  return "これから効く版";
}

export function LegalDocumentPage({ view }: { view: LegalDocumentView }) {
  const { version, body, history, currentVersion } = view;
  const title = LEGAL_DOCUMENT_TITLES[version.document];
  const next = history.find((v) => currentVersion !== undefined && v.version > currentVersion);
  return (
    <Page>
      <main>
        <Stack gap={6}>
          <Stack gap={2}>
            <Heading level={1}>{title}</Heading>
            <Muted>
              版 {version.version}({statusOf(version, currentVersion)})・{at(version.effectiveAt)}{" "}
              から
            </Muted>
          </Stack>
          {next && next.version !== version.version ? (
            <Alert tone="info">
              {at(next.effectiveAt)} から、版 {next.version} に変わります。{next.summary}{" "}
              <Link href={`/legal/${next.document}/${next.version}`}>変更後の内容を読む</Link>
            </Alert>
          ) : null}
          <Card>
            <Stack gap={4}>
              {parseMarkdown(body).map((block, i) => {
                const key = `${block.kind}-${i}`;
                if (block.kind === "heading")
                  return (
                    <Heading key={key} level={2}>
                      {block.text}
                    </Heading>
                  );
                if (block.kind === "list")
                  return (
                    <List key={key} label={`${title}の箇条`}>
                      {block.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </List>
                  );
                return <Text key={key}>{block.text}</Text>;
              })}
            </Stack>
          </Card>
          <Stack gap={2}>
            <Heading level={2}>変更の履歴</Heading>
            <List label="変更の履歴">
              {[...history].reverse().map((v) => (
                <li key={v.version}>
                  <Link href={`/legal/${v.document}/${v.version}`}>版 {v.version}</Link>・
                  {at(v.effectiveAt)} から・{v.summary}
                  {v.reconsent ? "(同意し直しをお願いした変更)" : ""}
                </li>
              ))}
            </List>
          </Stack>
        </Stack>
      </main>
    </Page>
  );
}
