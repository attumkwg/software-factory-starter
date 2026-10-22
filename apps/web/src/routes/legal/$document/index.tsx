import { createFileRoute, notFound } from "@tanstack/react-router";
import { legalDocumentHead, legalDocumentView } from "../../../legal/view.ts";
import { LegalDocumentPage } from "../../../pages/LegalDocumentPage.tsx";

// 利用規約・プライバシーポリシーの、いま効いている版(ログイン無しで読める。docs/specs/0009-legal-consent.md)
export const Route = createFileRoute("/legal/$document/")({
  loader: ({ params }) => {
    const view = legalDocumentView(params.document);
    if (!view) throw notFound();
    return view;
  },
  head: ({ params }) => legalDocumentHead(params.document),
  component: LegalDocumentRoute,
});

function LegalDocumentRoute() {
  return <LegalDocumentPage view={Route.useLoaderData()} />;
}
