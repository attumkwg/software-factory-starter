import { LEGAL_DOCUMENT_TITLES, type Me } from "@app/shared";
import { Alert, Inline, Link, Stack } from "@app/ui";
import { formatDate } from "../format.ts";

// 規約の変更の予告の帯(docs/specs/0009-legal-consent.md)。公開済みでまだ効いていない版のうち、まだ同意していない版ごとに1行。
// 効力の日が来たら消える(同意し直しの版なら、同意の画面に変わる)。閉じられない(予告の期間だけ出る)。
export function LegalNotices({ me }: { me: Me }) {
  const notices = (me.legal?.upcoming ?? []).filter((u) => !u.accepted);
  if (notices.length === 0) return null;
  return (
    <Stack gap={2}>
      {notices.map((u) => (
        <Alert key={`${u.document}-${u.version}`} tone="info">
          <Inline gap={2} align="center">
            <span data-testid="legal-notice">
              {LEGAL_DOCUMENT_TITLES[u.document]}が {formatDate(u.effectiveAt, me.timeZone)}{" "}
              に変わります。{u.summary}
            </span>
            <Link href={`/legal/${u.document}/${u.version}`}>変更後の内容を読む</Link>
            {u.reconsent ? <Link href="/legal/accept">前もって同意する</Link> : null}
          </Inline>
        </Alert>
      ))}
    </Stack>
  );
}

/** 画面の下のリンク(ログインの前後どちらでも読める) */
export function LegalLinks() {
  return (
    <nav aria-label="規約">
      <Inline gap={3}>
        <Link href="/legal/terms">{LEGAL_DOCUMENT_TITLES.terms}</Link>
        <Link href="/legal/privacy">{LEGAL_DOCUMENT_TITLES.privacy}</Link>
      </Inline>
    </nav>
  );
}
