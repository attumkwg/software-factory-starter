# 領域: プロジェクト(projects)

> タスクをまとめる入れ物。組織の中にある。

## エンティティ

| もの | 表 | 持っていること |
|---|---|---|
| プロジェクト | `projects` | 名前・作った人(`created_by`)・作った日時 |

## 状態

- 「ある」か「消された」だけ。消すとすぐ無くなり、中のタスクも全部消える(戻せない)。

## 守るルール

1. 名前は前後の空白を落として 1〜100文字(`packages/shared` の `CreateProjectSchema`)。
2. 作れるのは admin と member。**消せるのは admin だけ**(`docs/authz/matrix.yaml`)。
3. 他の組織のプロジェクトは、ID を指定しても「無い」(404)。
4. 作った人は同じ組織の利用者(`(tenant_id, created_by)` で参照)。

## 他の領域との境目

| 相手 | 渡すもの | 受け取るもの |
|---|---|---|
| organizations | — | 組織と利用者(誰が作ったか) |
| tasks | プロジェクトの ID(タスクの親) | — |

## 関係するファイル

- `apps/api/src/domains/projects/`(Postgres のスキーマ `projects`)。ほかの領域へ出しているのは `index.ts` の `projectExists`
- `apps/web/src/pages/ProjectsPage.tsx`
- `docs/specs/0001-tasks.md`(最初の仕様)・`docs/db/projects.projects.md`

## これから決めること

- 消す前の「アーカイブ」(戻せる片付け)を作るか
- プロジェクトごとのメンバー(いまは組織の全員が全プロジェクトを見られる)
