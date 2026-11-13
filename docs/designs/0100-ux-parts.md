# 設計: 使いやすさの部品を足し、今の画面の重い所見を直す

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人に判断してほしい所」だけを読む。
> 仕様: [docs/specs/0101-ux-parts.md](../specs/0101-ux-parts.md)
> 状態: 完了
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし」と書く。

## 0. 全体像

- `packages/ui`: `ActionMenu`(行の操作の「…」)・`EmptyState`・`Toast` の操作(`show(文, { action })`)・`ConfirmDialog` を `isOpen`/`onOpenChange` でも開けるように・`Table` の `emptyState`・CSS(ボタンを折り返さない・`aria-current` の下線・押せないチェックを薄く・メニュー・空の状態・トーストの並び)
- `apps/web`: `useAction` の `undo`・タスク(メニュー+確認・完了の知らせと元に戻す・件数・空の状態)・プロジェクト(メニュー+確認・空の状態)・メールを止める確認・設定のカードの主ボタンを secondary に・組織の一覧の空の文・ヘッダーのいまここ(`sectionOf`)とログアウトの形・戻る道(組織の人・招待・監査ログ・サポートへの許可・規約)・招待の「返事待ち」
- 機械の検査(仕様 0100)の外れの一覧を空にした・部品の一覧ページに並べた・`docs/design-system.md` に書いた

## 作業の前に読んだ物(ガイド)

- `docs/design-system.md`・`docs/guides/ux-review.md`・`docs/ux/2026-11-14-all-screens.md`・`docs/ux/usability/2026-11-14.md`
- `packages/ui/src/components/*`・`apps/web/src/use-action.ts`・`apps/web/src/pages/{TasksPage,ProjectsPage,AppHeader}.tsx`
- E2E で文や押し方に頼る所(`invitations.spec.ts`・`design-system.spec.ts`・`task-flow.spec.ts`・`mail.spec.ts`)

## 1. 設計方針

- 部品は React Aria の土台を包む(`MenuTrigger`・`Menu`・`Popover`)。見た目は今あるトークンだけ
- 戻せない操作は確認、戻せる操作は元に戻す(手引きの 7)
- 機械の検査(ラチェット)を空にして、これより後に外れが増えたら CI で止まる

## 2. データモデル

- 該当なし。

## 3. API

- 該当なし(アプリの API は変えない)。部品の props:

| 部品 | props |
|---|---|
| `ActionMenu` | `label`・`items: { id, label, isDestructive? }[]`・`onAction(id)`・`isDisabled?` |
| `EmptyState` | `title`・`description?`・`action?` |
| `useToast().show` | `(message, { action?: { label, onPress } })`。操作つきは `actionDurationMs`(既定 8000) |
| `ConfirmDialog` | 今までの props に、`trigger` が無いとき `isOpen`・`onOpenChange` |
| `Table` | `emptyState?: ReactNode`(あれば `emptyMessage` より先) |
| `useAction().run` | `opts.undo?: ToastAction` |

## 4. 状態遷移

- タスクの行は仕様の第2部の表のとおり。確認のダイアログは「…」→ 消す で開き、やめる・Esc・消す で閉じる

## 5. システム間連携

- 該当なし。

## 6. 業務ルール

- 仕様の業務ルールのとおり。いまここの割り当ては `AppHeader.tsx` の `sectionOf`

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 消すは「…」の奥で、確認が出る | `TasksPage.tsx`・`ProjectsPage.tsx`・`ActionMenu` | `apps/web/src/ux-rules.test.ts`(戻せない操作を直に呼ぶ所が0) |
| 完了にすると知らせと元に戻す | `TasksPage.tsx` の `setDone`・`Toast` | (手で確かめる: 初見の利用者テストの2回目で U-1 を回した → `docs/ux/usability/2026-11-14-2.md`) |
| メールの止めるは確認 | `TaskMailCard.tsx` | `apps/web/src/ux-rules.test.ts` |
| 空のとき何をすれば増えるか | `EmptyState`・`Table` の `emptyState` | `apps/web/src/ux-rules.test.ts`(空の文の無い表が0) |
| いまここと戻る道 | `AppHeader.tsx` の `sectionOf`・各画面 | (手で確かめる: VRT の基準の画像で見た) |
| 設定のカードに主ボタンが無い | `pages/settings/*Card.tsx` | `apps/web/src/ux-rules.test.ts`・`apps/web/e2e/ux-rules.spec.ts` |
| 外れの一覧が空 | 仕様 0100 のラチェット | `apps/web/src/ux-rules.test.ts` |
| 招待の状態が「返事待ち」 | `InvitationsPage.tsx` | `apps/web/e2e/invitations.spec.ts` |

## 8. 非機能

- a11y: 「…」は名前つきのボタン(「<名前> の操作」)・キーボードで開ける・44px 角。トーストの操作は aria-live の中のボタン
- 性能・費用: 該当なし

## 9. このプロダクト特有

- タスクの完了は、プロジェクトを作った人へのメールにつながる(仕様 0002)。元に戻すと、送り出し前ならメールは送られない(設計書 0089 の作り直しの決まりのまま)

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 危ない操作と戻し方 | 最重要 | ❌ の所見と、利用者テストの3人の「怖い」 |
| 画面の状態・見た目の強弱・迷わなさ | 採用 | 空の状態・主ボタン・いまここ・戻る道 |
| 画面の部品 | 最重要 | 画面で工夫せず、部品に足した |
| 要求との対応 | 機械で検証 | ラチェットを空にした・E2E・VRT |
| データモデル・API・状態遷移(サーバー)・システム間連携 | 低優先 | サーバーは変えない |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- 新しい色を足さない(下線と薄さで足りる)。色が要るなら人に聞く
- タスクの消すは確認(元に戻すは作り直しになり、id と作った日が変わる)
- 「…」は 44px 角

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|
| (なし) | | | | | | |

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
