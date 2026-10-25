# 設計: 領域ごとの CLAUDE.md の型と、領域を足す手順

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0050-domain-claude-md.md](../specs/0050-domain-claude-md.md)
> 状態: 下書き
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

領域ごとの CLAUDE.md の型を `docs/domain/_template-CLAUDE.md` に置き、今の4領域に実物を作る。新しい領域を足す手順をスキル `add-domain` にまとめ、その中で CLAUDE.md も型から作る。

## 作業の前に読んだ物(ガイド)

- 想定の場面 `docs/scenarios/07-grow.md` の 7-3、`gaps.md` の G-16。
- `apps/api/CLAUDE.md`(領域の決まり)・ADR 0004・`apps/api/src/domains/dependencies.ts`(organizations は何も使わない・projects → organizations・tasks → organizations と projects・legal → organizations)・`apps/api/test/unit/domain-boundaries.test.ts`(向き・`index.ts` だけ・輪・フォルダ名 = スキーマ名。`.ts` だけを読むので CLAUDE.md を置いても影響しない)。
- 各領域の `index.ts` の出している物・`src/outbox/topics.ts`(出来事)・`src/audit/actions.ts`(監査ログの名前)・`docs/authz/matrix.yaml`(パス)・`docs/domain/<領域>/README.md`・`test/unit`・`test/integration` のファイル。
- `drizzle/0002_domain_schemas.sql`(スキーマとロールへの GRANT の見本)・`src/offboarding/delete-tenant.ts`(`TENANT_TABLES`)・`.claude/skills/update-domain-docs`・`add-api-endpoint`・`db-migration`。

## 1. 設計方針

- **CLAUDE.md は短い入口、正は README とテスト**。守るルール・状態・言葉は `docs/domain/<領域>/README.md`、境界は `domain-boundaries` のテスト。CLAUDE.md は「触ってよい所・触らない所・先に読む・外との出入り・流すテスト」だけで、書き写さない(2か所になって食い違うのを防ぐ)。
- 置き場所は領域のフォルダの中(`apps/api/src/domains/<領域>/CLAUDE.md`)。Claude Code はそのフォルダのファイルを触るときに読み込む。
- 型は `docs/domain/` に置く(領域のフォルダに `_template` を作ると、領域と見なされうる)。
- 新しい領域の手順はスキル(`add-domain`)。手引きにしないのは、AI が手順どおりに1つの PR でそろえる作業だから(`add-api-endpoint` と同じ形)。
- ADR は足さない(既存の領域の決まり ADR 0004 の入口を足すだけ)。

## 2. データモデル

該当なし(DB に触らない)。

## 3. API

該当なし。

## 4. 状態遷移

該当なし。

## 5. システム間連携

該当なし。

## 6. 業務ルール

- 型の見出し: 触ってよい所(領域のフォルダ・画面・契約・資料)/ 触らない所(ほかの領域のフォルダ・ほかのスキーマの表・向きと共通の部品)/ 先に読む(README・仕様・権限の表の行)/ 外との出入り(`index.ts` の関数・出来事・監査ログの名前)/ 流すテスト(単体・結合の当たるファイル・いつも流す分離のテスト)。
- 4領域の中身は今のコードから引いた(作業の前に読んだ物)。organizations は「ほかの全部が使う土台」と、auth・authz・db が危険度「高」であることを頭に。legal は文面と同意し直しは法務が決めること・公開した版を書き換えないことを頭に。
- `add-domain` の手順: 決める(名前・向き・持ち主)→ 作る(向き・4つのファイル・移行・分類・解約・API・README・CLAUDE.md・表の説明書・CODEOWNERS)→ 確かめる。
- 領域の出入りが変わったら、`/update-domain-docs` が CLAUDE.md の「外との出入り」と「触らない所」も直す。

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 型がある・書き写さない | 1.・6.・`docs/domain/_template-CLAUDE.md` | 人の確認 |
| 4領域の CLAUDE.md が今のコードと合う | 6. | `index.ts`・`topics.ts`・`actions.ts`・`matrix.yaml` と突き合わせた。`domain-boundaries` は `.ts` だけを読む |
| `add-domain` の手順 | 6.・スキル | 人の確認 |
| ほかから指す | `apps/api/CLAUDE.md`・`CLAUDE.md`・`update-domain-docs` | 人の確認 |

## 8. 非機能

- 運用: CLAUDE.md が古くなるのを防ぐため、中身は「出入り」の名前とファイルの場所だけにし、出入りが変わる PR で `/update-domain-docs` が直す。
- 費用: 0円。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離 | 「いつも流すテスト」に `tenant-isolation`・`authz-matrix`・`rls` |
| 権限の表 | 「先に読む」に当たる行 |
| 監査ログ | 「外との出入り」に名前 |
| 解約で消す一覧 | `add-domain` の手順の 5 |
| サポートの代理ログイン | organizations の「触らない所」に関所を緩める変更 |
| ログの個人情報・列の分類 | `add-domain` の手順の 4 |
| 画面の部品 | 該当なし |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | **最重要** | 正は README とテスト・CLAUDE.md は書き写さない |
| 業務ルール | 採用 | 型の見出しと add-domain の手順 |
| 要求との対応 | 軽く確認 | 4領域の中身がコードと合うか |
| データモデル・API・状態遷移・システム間連携 | 低優先 | 触らない |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- CLAUDE.md に守るルールを書き写さず、README とテストを指す — 2か所になると食い違う。境界はテストが守るので、CLAUDE.md で緩めても効かない。
- 型を `docs/domain/` に置く — 領域のフォルダに `_template` を作ると領域と見なされうる。
- 手順をスキルにした — AI が1つの PR でそろえる作業(`add-api-endpoint` と同じ)。
- 今の4領域にも作った — 型だけだと「見本」が無く、領域の作業ですぐ効かない。
- カタログに足していない — `add-api-endpoint`・`db-migration` と同じく土台の手順のスキル(消す部品ではない)。
- 人に聞く4つに当たる判断は無い — どれも作りの決め方(領域の分け方は ADR 0004 のまま)。
- ADR は足さない — 1. の理由。
- 想定の場面(`docs/scenarios/`)は直さない — 場面の持ち主が直す。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

> 4つに当たる判断だけ。状態の書き方は [guides/human-review.md](../guides/human-review.md) の 2。`pnpm decisions` がここを読む。**`仮決め` が残る PR はマージしない。**

なし。

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
