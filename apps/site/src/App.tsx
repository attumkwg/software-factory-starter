import type { SiteConfig } from "./config.ts";
import type { PageName } from "./head.ts";
import { Landing } from "./pages/Landing.tsx";
import { ConfirmPage, WithdrawPage } from "./pages/LinkPage.tsx";

export function App({ page, config }: { page: PageName; config: SiteConfig }) {
  if (page === "confirm") return <ConfirmPage config={config} />;
  if (page === "withdraw") return <WithdrawPage config={config} />;
  return <Landing config={config} />;
}
