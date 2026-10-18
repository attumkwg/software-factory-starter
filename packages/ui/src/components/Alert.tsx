import type { ReactNode } from "react";
import { cx } from "../cx.ts";

/**
 * 画面に残すお知らせ(ログインの失敗など)。トーストと違って消えない。
 * danger は role="alert"(出たときに読み上げる)。色だけで意味を伝えないので、文で何が起きたかを書く。
 */
export function Alert({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "info";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx("ui-alert", `ui-alert--${tone}`)}
    >
      {children}
    </div>
  );
}
