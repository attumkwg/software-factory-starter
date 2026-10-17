# デザインシステム(packages/ui)

> 画面は **`@app/ui` の部品だけ**で作る。色・余白・文字・角丸は `packages/ui/src/tokens.css` の変数だけ。
> 生の色コード(`#fff`・`rgb()`)・直書きのスタイル(`style={...}`)・画面ごとの CSS は Semgrep が止める。
> 土台は React Aria Components(選んだ理由は [ADR 0002](adr/0002-design-system-react-aria.md))。

## 何があるか

| 部品 | 使う所 | 気をつけること |
|---|---|---|
| `Button` | 押す操作 | `variant`: primary(1画面に1つ)/ secondary / danger(戻せない)/ ghost(文字だけ) |
| `TextField` | 1行の入力 | `label` は必ず付ける(見えて、読み上げにも使う)。エラーは `errorMessage` |
| `Select` | 選択肢から1つ | 選択肢は `{ id, label }` の配列 |
| `Checkbox` | オン・オフ | 選ぶと文字に線(完了のタスク) |
| `Table` | 一覧(列がある) | `label` で表の名前。行の名前にする列に `isRowHeader` |
| `List` | 一覧(列が無い) | `label` で一覧の名前 |
| `ConfirmDialog` | 消すなどの前の確認 | 戻せない操作は `isDestructive`(赤いボタン)。Esc で閉じる |
| `ToastProvider` / `useToast` | 操作の結果を短く知らせる | 読み上げにも届く。大事なエラーはトーストにせず画面に残す |
| `Badge` | ロール・状態の札 | 色だけで意味を伝えない(必ず文字) |
| `Page` / `Stack` / `Inline` / `Card` / `Heading` / `Muted` | 並べる・囲む・見出し | 間は `gap`(余白のトークン)。見出しは文書の構造に合わせて `level` |

使い方の例は `apps/web/src/pages/` を見る。

## 使い方の決まり

1. 画面(`apps/web`)では `@app/ui` から import する。`react-aria-components` を直接使わない。
2. 見た目は部品の props(`variant`・`size`・`gap`・`tone`)で決める。`style={...}` や `className` を画面で書かない。
3. 足りないときは、画面で工夫せずに `packages/ui` に部品か props を足す(下の手順)。
4. ボタン・入力・一覧には、必ず見える名前か `aria-label` を付ける(E2E の axe が確かめる)。

## 部品を足す手順

1. **本当に新しい部品か**確かめる。既存の部品の props を1つ足せば済むなら、そちらにする。
2. React Aria Components に土台があるか見る([部品の一覧](https://react-spectrum.adobe.com/react-aria/components.html))。あれば包む。無ければ HTML の正しい要素(`button`・`ul` など)で作る。
3. `packages/ui/src/components/<名前>.tsx` に書き、`packages/ui/src/index.ts` から export する。
4. 見た目は `packages/ui/src/styles.css` に、クラス名 `ui-<名前>` で。値は必ずトークン(`var(--...)`)。状態は React Aria が付ける `data-hovered`・`data-selected`・`data-focus-visible` などで書き分ける。
5. 画面で使い、E2E を回す(axe が問題を拾う)。キーボードだけで操作できるかを手で1回確かめる。
6. この表(何があるか)に1行足す。

**新しい色や余白が要るとき**は、トークンを足す提案を PR の「人に判断してほしい所」に書く(トークンを決めるのは人)。

## 人と AI の分担

| | 人(デザイナー・プロダクトの人) | AI |
|---|---|---|
| ブランドの色・文字・余白(トークン) | 決める | 案を出す・コントラストを計算する |
| 部品の種類と振る舞い | 決める(何が要るか・どう動くべきか) | 作る・テストする |
| 画面 | 受け入れ条件と、見本の絵(あれば) | 部品を組み合わせて作る |
| アクセシビリティ | キーボードと読み上げで最後に触って確かめる | axe を通す・名前とラベルを付ける |

## 確かめる仕組み

| 何を | どうやって | いつ |
|---|---|---|
| 生の色・直書きのスタイル・画面の CSS | Semgrep(`.semgrep/design/`、テストつき) | 毎 PR(`ci.yml`) |
| 色のコントラスト・ラベル・名前の漏れ | axe(E2E の各画面) | 毎 PR(`ci.yml` の E2E) |
| キーボードだけで使えるか・読み上げの順番 | 人が触る | 危険度「中」以上の画面の変更 |

## 部品の見本(Storybook など)

まだ入れていない。部品が増えて「見本を並べて確かめたい」となったら、手元で動かすだけの形で入れる(CI には足さない)。
いまは `pnpm dev` で画面を開き、ログイン → プロジェクト → タスクで全部の部品が出る。
