# 領域: タスク(tasks)

> この領域の作業をする AI 向けの1枚。言葉・状態・守るルールの正は [docs/domain/tasks/README.md](../../../../../docs/domain/tasks/README.md)。ルートと `apps/api/CLAUDE.md` の決まりはそのまま効く。
> 持ち主: (人数が増えたら CODEOWNERS のチーム)。1つの Issue で触るのは、この領域だけにする。

## 触ってよい所

- `apps/api/src/domains/tasks/`
- 画面: `apps/web/src/pages/TasksPage.tsx`
- 契約: `packages/shared` のタスクのスキーマ(`CreateTaskSchema`・`UpdateTaskSchema` など。足すだけ)
- 資料: `docs/domain/tasks/README.md`・`docs/db/tasks.tasks.md`(`pnpm docs:db`)

## 触らない所(触るなら別の Issue か、人に聞く)

- ほかの領域のフォルダ。使ってよいのは organizations・projects の `index.ts` だけ(`../dependencies.ts`)
- `projects.projects` などほかのスキーマの表を読む SQL(親のプロジェクトは projects の `projectExists`)
- 向きを足す(`../dependencies.ts`)・共通の部品(`src/db`・`src/authz`・`src/auth`・`src/http`)

## 先に読む

- `docs/domain/tasks/README.md`
- 仕様: `docs/specs/0001-tasks.md`・`docs/specs/0002-task-completed-mail.md`
- 権限の表: `docs/authz/matrix.yaml` の `/api/projects/{projectId}/tasks`・`/api/tasks/{taskId}`

## 外との出入り

- ほかへ出している物(`index.ts`): `taskRoutes`・`taskCompletedMail`・`exportTasksPage`(書き出し)
- 外へ知らせる出来事: `tasks.task_completed`(未完了 → 完了。アウトボックス)
- 監査ログ: `task.create`・`task.update`・`task.delete`

## 流すテスト

- 単体: `pnpm --filter @app/api test`(`domain-boundaries` を含む)
- 結合(Docker): `pnpm --filter @app/api test:integration -- outbox mail export-stream`
- いつも: `tenant-isolation`・`authz-matrix`・`rls`
