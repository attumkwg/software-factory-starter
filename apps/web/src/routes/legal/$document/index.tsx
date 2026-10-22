import { LEGAL_DOCUMENT_TITLES, LegalDocumentSchema } from "@app/shared";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { legalDocumentView } from "../../../legal/view.ts";
import { LegalDocumentPage } from "../../../pages/LegalDocumentPage.tsx";

// 利用規約・プライバシーポリシーの、いま効いている版(ログイン無しで読める。docs/specs/0009-legal-consent.md)
export const Route = createFileRoute("/legal/$document/")({
  loader: ({ params }) => {
    const view = legalDocumentView(params.document);
    if (!view) throw notFound();
    return view;
  },
  head: ({ params }) => {
    const document = LegalDocumentSchema.safeParse(params.document);
    const title = document.success ? LEGAL_DOCUMENT_TITLES[document.data] : "見つかりません";
    return { meta: [{ title: `${title} | Tasks` }] };
  },
  component: LegalDocumentRoute,
});

function LegalDocumentRoute() {
  return <LegalDocumentPage view={Route.useLoaderData()} />;
}
