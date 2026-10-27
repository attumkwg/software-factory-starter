// 領域「ファイル」の公開の入口(ほかからはここだけを使う)。docs/specs/0072-file-storage.md
export { type FileProcessDeps, handleFileDeleted, handleFileUploaded } from "./process.ts";
export { exportFilesPage, type FileExportCursor } from "./repository.ts";
export { type FileRouteDeps, fileRoutes } from "./routes.ts";
