import { safeReturnTo } from "@app/shared";
import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "../../../head.ts";
import { LegalAcceptPage } from "../../../pages/LegalAcceptPage.tsx";

// 同意の画面(docs/specs/0009-legal-consent.md)。同意したら元の画面(returnTo。アプリの中のパスだけ)へ戻る
export const Route = createFileRoute("/_app/legal/accept")({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => {
    const returnTo = safeReturnTo(search.returnTo);
    return returnTo !== "/" ? { returnTo } : {};
  },
  head: () => pageHead({ title: "利用規約などへの同意" }),
  component: LegalAcceptRoute,
});

function LegalAcceptRoute() {
  const { me } = Route.useRouteContext();
  const { returnTo } = Route.useSearch();
  return <LegalAcceptPage me={me} returnTo={safeReturnTo(returnTo)} />;
}
