import { ToastProvider } from "@app/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "@app/ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root がありません");
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
