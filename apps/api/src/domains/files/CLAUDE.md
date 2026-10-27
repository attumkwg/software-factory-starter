# 領域: ファイル(files)

> この領域の作業をする AI 向けの1枚。言葉・状態・守るルールの正は [docs/domain/files/README.md](../../../../../docs/domain/files/README.md)。ルートと `apps/api/CLAUDE.md` の決まりはそのまま効く。
> 持ち主: (人数が増えたら CODEOWNERS のチーム)。1つの Issue で触るのは、この領域だけにする。

## 触ってよい所

- `apps/api/src/domains/files/`
- 画面: (まだ無い。題材を差し替えるときに付け先の画面と一緒に作る)
- 契約: `packages/shared` の `files.ts`(`FILE_LIMITS`・`CreateFileSchema` など。足すだけ)
- 資料: `docs/domain/files/README.md`・`docs/db/files.files.md`(`pnpm docs:db`)

## 触らない所(触るなら別の Issue か、人に聞く)

- ほかの領域のフォルダ。使ってよいのは organizations・tasks の `index.ts` だけ(`../dependencies.ts`)
- `tasks.tasks` などほかのスキーマの表を読む SQL(付け先のタスクは tasks の `taskExists`)
- 置き場の部品 `src/storage/`(キー・絞った権限)と、移行 `drizzle/0023_file_storage.sql` の引き金。どちらも他社への漏えいに直結する(危険度「高」として扱う)
- 向きを足す(`../dependencies.ts`)・共通の部品(`src/db`・`src/authz`・`src/auth`・`src/http`)

## 先に読む

- `docs/domain/files/README.md`
- 仕様: `docs/specs/0072-file-storage.md`・設計書 `docs/designs/0072-file-storage.md`・ADR 0079・0080
- 権限の表: `docs/authz/matrix.yaml` の `/api/tasks/{taskId}/files`・`/api/files/{fileId}`

## 外との出入り

- ほかへ出している物(`index.ts`): `fileRoutes`・`handleFileUploaded`・`handleFileDeleted`(送り出しの受け手)
- 外へ知らせる出来事: `files.file_uploaded`(上げ終えた)・`files.file_deleted`(行が消えた。引き金が積む)
- 監査ログ: `file.create`・`file.complete`・`file.delete`

## 流すテスト

- 単体: `pnpm --filter @app/api test`(`storage`・`strip-metadata`・`domain-boundaries`)
- 結合(Docker): `pnpm --filter @app/api test:integration -- files` … `files.int.test.ts`・`files-object-store.int.test.ts`(S3 互換の置き場のコンテナ)
- いつも: `tenant-isolation`・`authz-matrix`・`rls`・`personal-data-logs`・`offboarding`・`person-data`
