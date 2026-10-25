import { z } from "zod";

// 画面(ブラウザ)では、Zod が検証を速くするために `new Function` を試すのを止める。
// 画面は CSP で `eval` の類を許さない(script-src に 'unsafe-eval' が無い)ので、試すだけで CSP の違反が出る。
// Zod は schema を作るときに試すので、index.ts のいちばん先に読み込み、ほかの schema より前に効かせる。
// サーバー(API と SSR)には CSP が無いので、速い方のまま。設計書 0045
if ("document" in globalThis) z.config({ jitless: true });
