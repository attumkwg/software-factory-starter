import { LEGAL_DOCUMENT_TITLES, LegalDocumentSchema } from "@app/shared";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { legalDocumentView } from "../../../legal/view.ts";
import { LegalDocumentPage } from "../../../pages/LegalDocumentPage.tsx";

// 利用規約・プライバシーポリシーの、版を選んだ本文(前の版・これから効く版)。公開前の版は「見つかりません」
export const Route = createFileRoute("/legal/$document/$version")({
  loader: ({ params }) => {
    const view = legalDocumentView(params.document, params.version);
    if (!view) throw notFound();
    return view;
  },
  head: ({ params }) => {
    const document = LegalDocumentSchema.safeParse(params.document);
    const title = document.success ? LEGAL_DOCUMENT_TITLES[document.data] : "見つかりません";
    return { meta: [{ title: `${title}(版 ${params.version}) | Tasks` }] };
  },
  component: LegalVersionRoute,
});

function LegalVersionRoute() {
  return <LegalDocumentPage view={Route.useLoaderData()} />;
}
