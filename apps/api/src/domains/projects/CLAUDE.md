# 領域: プロジェクト(projects)

> この領域の作業をする AI 向けの1枚。言葉・状態・守るルールの正は [docs/domain/projects/README.md](../../../../../docs/domain/projects/README.md)。ルートと `apps/api/CLAUDE.md` の決まりはそのまま効く。
> 持ち主: (人数が増えたら CODEOWNERS のチーム)。1つの Issue で触るのは、この領域だけにする。

## 触ってよい所

- `apps/api/src/domains/projects/`
- 画面: `apps/web/src/pages/ProjectsPage.tsx`
- 契約: `packages/shared` のプロジェクトのスキーマ(`CreateProjectSchema` など。足すだけ)
- 資料: `docs/domain/projects/README.md`・`docs/db/projects.projects.md`(`pnpm docs:db`)

## 触らない所(触るなら別の Issue か、人に聞く)

- ほかの領域のフォルダ。使ってよいのは organizations の `index.ts` だけ(`../dependencies.ts`)。tasks はこの領域を使う側(逆向きに使わない)
- `tasks.tasks` などほかのスキーマの表を読む SQL(プロジェクトを消すとタスクも消えるのは DB の参照で。タスクの表を直接消さない)
- 向きを足す(`../dependencies.ts`)・共通の部品(`src/db`・`src/authz`・`src/auth`・`src/http`)

## 先に読む

- `docs/domain/projects/README.md`(消せるのは admin だけ・作った人は同じ組織)
- 仕様: `docs/specs/0001-tasks.md`
- 権限の表: `docs/authz/matrix.yaml` の `/api/projects`・`/api/projects/{projectId}`

## 外との出入り

- ほかへ出している物(`index.ts`): `projectRoutes`・`projectExists`・`findProjectOwner`・`exportProjectsPage`(書き出し)
- 外へ知らせる出来事: なし
- 監査ログ: `project.create`・`project.delete`

## 流すテスト

- 単体: `pnpm --filter @app/api test`(`domain-boundaries` を含む)
- 結合(Docker): `pnpm --filter @app/api test:integration -- export-stream offboarding`
- いつも: `tenant-isolation`・`authz-matrix`・`rls`
