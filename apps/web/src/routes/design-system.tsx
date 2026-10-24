import { createFileRoute, notFound } from "@tanstack/react-router";
import { designSystemVisible } from "../design-system.ts";
import { pageHead } from "../head.ts";
import { DesignSystemPage } from "../pages/DesignSystemPage.tsx";
import { reportingConfig } from "../report-error.ts";

// 部品の一覧(@app/ui の見本)。本番では「ページが見つかりません」(404)。API は読まない
export const Route = createFileRoute("/design-system")({
  beforeLoad: () => {
    if (!designSystemVisible(reportingConfig().environment)) throw notFound();
  },
  head: () =>
    pageHead({
      title: "部品の一覧",
      description: "画面の部品(デザインシステム)の見本を、種類ごとに並べます。",
      path: "/design-system",
    }),
  component: DesignSystemPage,
});
