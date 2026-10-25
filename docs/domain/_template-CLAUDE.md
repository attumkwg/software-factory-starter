# 領域: <領域の名前>(<フォルダ名 = Postgres のスキーマ名>)

<!--
領域ごとの CLAUDE.md の型(設計書 docs/designs/0050-domain-claude-md.md)。
置き場所: apps/api/src/domains/<領域>/CLAUDE.md。Claude Code はこのフォルダのファイルを触るときに読む。
- 短く(1画面)。言葉・状態・守るルールの正は docs/domain/<領域>/README.md。ここに写さず指す。
- 書くのは「この領域の作業で、どこを触ってよいか・触らないか・先に読む物・流すテスト・持ち主」だけ。
- ルートの CLAUDE.md と apps/api/CLAUDE.md の決まりは、全部そのまま効く(繰り返さない)。
- 領域を足すときは .claude/skills/add-domain の手順で、この型を写して作る。
-->

> この領域の作業をする AI 向けの1枚。言葉・状態・守るルールの正は [docs/domain/<領域>/README.md](../../../../../docs/domain/<領域>/README.md)。ルートと `apps/api/CLAUDE.md` の決まりはそのまま効く。
> 持ち主: <CODEOWNERS のチーム(人数が増えたら)>。1つの Issue で触るのは、この領域だけにする。

## 触ってよい所

- `apps/api/src/domains/<領域>/`
- 画面: `apps/web/src/pages/<…>.tsx`
- 契約: `packages/shared` の <…> のスキーマ(足すだけ。消さない)
- 資料: `docs/domain/<領域>/README.md`・`docs/db/<領域>.*.md`(`pnpm docs:db` で作る)

## 触らない所(触るなら別の Issue か、人に聞く)

- ほかの領域のフォルダ。使ってよいのは <使ってよい領域> の `index.ts` だけ(`../dependencies.ts`)
- ほかのスキーマの表を読み書きする SQL(要るなら相手の `index.ts` の関数)
- 向きを足す(`../dependencies.ts`)・共通の部品(`src/db`・`src/authz`・`src/auth`・`src/http`)。危険度「高」を含む

## 先に読む

- `docs/domain/<領域>/README.md`(守るルール・他の領域との境目)
- 仕様: `docs/specs/<…>.md`
- 権限の表: `docs/authz/matrix.yaml` の `<API のパス>` の行

## 外との出入り

- ほかの領域へ出している物(`index.ts`): <関数の名前>
- 外へ知らせる出来事(アウトボックス): <出来事の名前 / なし>
- 監査ログの名前(`src/audit/actions.ts`): <…>

## 流すテスト

- 単体: `pnpm --filter @app/api test`(`domain-boundaries` を含む)
- 結合(Docker): `pnpm --filter @app/api test:integration -- <ファイル名の一部>` … <この領域に当たるファイル>
- いつも: `tenant-isolation`・`authz-matrix`(他社が 404 になるか・権限の表とそろうか)
