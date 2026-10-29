# 領域: タスク(tasks)

> プロジェクトの中のやること。

## エンティティ

| もの | 表 | 持っていること |
|---|---|---|
| タスク | `tasks` | 題名・完了か(`done`)・作った日時・直した日時 |

## 状態

```
未完了 (done = false) ⇄ 完了 (done = true)
        └──────── 消す ────────┘(戻せない)
```

- 未完了と完了は何度でも行き来できる。

## 守るルール

1. 題名は前後の空白を落として 1〜200文字(`CreateTaskSchema`・`UpdateTaskSchema`)。
2. 直すときは、題名か完了のどちらかは必ず変える(空の更新は 400)。
3. 作る・直す・消すは admin と member。viewer は見るだけ。
4. **タスクの親のプロジェクトは同じ組織**。`(tenant_id, project_id)` で参照するので、他の組織のプロジェクトには付けられない。プロジェクトが消えるとタスクも消える。
5. 他の組織のタスクは、ID を指定しても「無い」(404)。
6. 未完了 → 完了で、プロジェクトを作った人にメールで知らせる(docs/specs/0002-task-completed-mail.md)。組織の管理者が止めていたら送らない(完了した時点と送る直前の両方で見る。止めていた間の分は戻しても送らない。docs/specs/0093-task-mail-switch.md)。

## 他の領域との境目

| 相手 | 渡すもの | 受け取るもの |
|---|---|---|
| projects | — | 親のプロジェクトの ID |
| organizations | — | 組織と、操作する人のロール |

## 関係するファイル

- `apps/api/src/domains/tasks/`(Postgres のスキーマ `tasks`)。使ってよい領域: organizations・projects
- 外へ知らせる出来事: `tasks.task_completed`(未完了 → 完了になったとき。アウトボックス。ADR 0006)
- `apps/web/src/pages/TasksPage.tsx`
- `docs/db/tasks.tasks.md`

## これから決めること

- 担当者・期限・並べ替え(`docs/specs/0001-tasks.md` の「やらないこと」)
