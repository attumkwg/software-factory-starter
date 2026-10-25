import "@app/ui/styles.css";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { PAGES, type PageName } from "./head.ts";

// ビルドで作った HTML に、動き(形・見た数)を付ける。設定はビルドのときに焼き込んだ物(vite.config.ts の define)。

const named = document.body.dataset.page ?? "";
const page: PageName = (PAGES as readonly string[]).includes(named)
  ? (named as PageName)
  : "landing";
const root = document.getElementById("root");
if (root) {
  hydrateRoot(
    root,
    <StrictMode>
      <App page={page} config={__SITE_CONFIG__} />
    </StrictMode>,
  );
}
