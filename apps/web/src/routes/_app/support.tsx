import { createFileRoute } from "@tanstack/react-router";
import { SupportStaffPage } from "../../pages/SupportStaffPage.tsx";

// 運営の社員の入口(番号を入れる)。運営の組織でなければ、入ろうとしても API が 403
export const Route = createFileRoute("/_app/support")({
  head: () => ({ meta: [{ title: "サポート | Tasks" }] }),
  component: SupportStaffPage,
});
