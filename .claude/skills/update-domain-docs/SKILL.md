---
name: update-domain-docs
description: コードの変更(ブランチの差分)を読み、ドメインの資料(docs/domain の用語集と領域の説明・docs/db・権限の表)のうち直すべき所を挙げて直す。ルール・言葉・状態・表を変えた PR を出す前や、「資料も直して」と言われたときに使う。
---

# ドメインの資料を、変更に合わせて直す

「いまの正」の資料(`docs/README.md` の上の表)を、コードと食い違わないようにする。記録(specs・adr・runbooks)は直さない。

## 手順

1. **差分を読む**: `git diff origin/main...HEAD --stat` と、中身(特に下のパス)。
   - `apps/api/src/domains/<領域>/schema.ts`・`apps/api/drizzle/` … 表・列・参照
   - `packages/shared/src/schemas.ts` … 入力のルール(文字数・必須)
   - `apps/api/src/authz/policy.ts`・`docs/authz/matrix.yaml` … 権限
   - `apps/api/src/domains/<領域>/routes.ts`・`repository.ts` … 振る舞い・状態の移り変わり
   - `apps/api/src/outbox/topics.ts` … その領域が外へ知らせる出来事
   - 画面の文言(`apps/web/src/`)… 新しい言葉
2. **直すべき所を挙げて、相手に見せる**(まだ直さない)。形:
   ```
   - docs/domain/glossary.md: 「期限(due_at)」を足す
   - docs/domain/tasks/README.md: 守るルールに「期限は今日以降」、エンティティに due_at
   - docs/db/: 移行が増えたので作り直す(pnpm docs:db)
   - (直さない) docs/specs/0001-tasks.md は記録なのでそのまま
   ```
3. OK なら直す。
   - 用語集: 日本語・コードでの名前・意味・例 の4つをそろえる。画面の文言と同じ言葉にする。
   - 領域の README: エンティティ・状態・守るルール・境目・関係するファイル・これから決めること の見出しを保つ。
   - `docs/db/`: 手で直さない。`docker compose up -d` のあと `pnpm docs:db`。個人情報の台帳 `docs/db/personal-data.md` は列の分類表から作る(`pnpm docs:db` の続きで作られる。DB 無しなら `pnpm docs:personal-data`)。新しい表なら `.tbls.yml` の `comments` に1行の説明と `docs/domain/<領域>` への道しるべを足す。
   - 新しい領域ができたら `docs/domain/<領域>/README.md` を、既存の領域の README と同じ見出しで作る。
4. コードと資料が食い違っていて、**どちらが正しいか分からない**ときは直さずに、PR の「人に判断してほしい所」に書く。

## してはいけない

- 仕様(`docs/specs/`)や ADR を今の姿に書き換える(記録なので残す)。
- 権限の表を、コードに合わせるためだけに変える(表が正。食い違いはテストが落とす)。
