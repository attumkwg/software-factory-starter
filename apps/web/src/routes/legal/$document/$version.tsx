import { createFileRoute, notFound } from "@tanstack/react-router";
import { legalDocumentHead, legalDocumentView } from "../../../legal/view.ts";
import { LegalDocumentPage } from "../../../pages/LegalDocumentPage.tsx";

// 利用規約・プライバシーポリシーの、版を選んだ本文(前の版・これから効く版)。公開前の版は「見つかりません」
export const Route = createFileRoute("/legal/$document/$version")({
  loader: ({ params }) => {
    const view = legalDocumentView(params.document, params.version);
    if (!view) throw notFound();
    return view;
  },
  head: ({ params }) => legalDocumentHead(params.document, params.version),
  component: LegalVersionRoute,
});

function LegalVersionRoute() {
  return <LegalDocumentPage view={Route.useLoaderData()} />;
}
