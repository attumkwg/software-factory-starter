# デザインシステム(packages/ui)

> 画面は **`@app/ui` の部品だけ**で作る。色・余白・文字・角丸は `packages/ui/src/tokens.css` の変数だけ。
> 生の色コード(`#fff`・`rgb()`)・直書きのスタイル(`style={...}`)・画面ごとの CSS は Semgrep が止める。
> 土台は React Aria Components(選んだ理由は [ADR 0002](adr/0002-design-system-react-aria.md))。

## 何があるか

| 部品 | 使う所 | 気をつけること |
|---|---|---|
| `Button` | 押す操作 | `variant`: primary(**1画面に1つ**。`ux-rules.spec.ts` が主な画面で数える。設定のようにカードが並ぶ画面のカードの中では使わない)/ secondary / danger(戻せない)/ ghost(文字だけ)。`size="sm"` は高さ約 32px(押す所の下限 24px は満たす。これより小さくしない)。文字は折り返さない |
| `Link` | ページの移動 | 本物の `<a href>`(新しいタブで開ける・SSR でも辿れる)。保存や削除には使わず `Button`。ナビでは今のページに `aria-current="page"`(下線で示す)。設定から開く画面・アプリの外の画面の上には `variant="back"` の戻る道 |
| `TextField` | 1行の入力 | 幅は 16rem まで、狭い画面では親の幅まで縮む(`min(16rem, 100%)`)。`label` は必ず付ける(見えて、読み上げにも使う)。エラーは `errorMessage`。パスワードは `type="password"` と `autoComplete`(`current-password` / `new-password`)、コードは `inputMode="numeric"` と `autoComplete="one-time-code"` |
| `Select` | 選択肢から1つ | 選択肢は `{ id, label }` の配列 |
| `Checkbox` | オン・オフ | 選ぶと文字に線(完了のタスク)。同意のチェックのように線が要らなければ `strikeWhenSelected={false}`。押せないときは四角が薄くなる(押せない理由は近くの文で) |
| `Table` | 一覧(列がある) | `label` で表の名前。行の名前にする列に `isRowHeader`。列が入りきらないとき(スマホ)は、表の枠(`.ui-table-scroll`)の中で横に動く。画面全体は横にはみ出さない。**空のときの文を必ず決める**(`emptyMessage` か、何をすれば増えるかまで出す `emptyState`。`ux-rules.test.ts` が見る) |
| `List` | 一覧(列が無い) | `label` で一覧の名前 |
| `ConfirmDialog` | 消すなどの前の確認 | 戻せない操作は `isDestructive`(赤いボタン)。Esc で閉じる。実行中は二度押せない(失敗は呼ぶ側の `useAction` で)。文は **何が・どこまで・戻せるか**。`trigger` の代わりに `isOpen`・`onOpenChange` で開け閉めもできる(`ActionMenu` から開くとき)。**戻せない操作の API は、押した瞬間に呼ばず、ここか「元に戻す」を通す**(`ux-rules.test.ts` が見る) |
| `ActionMenu` | 行の操作(「…」) | 消す・止めるなど、主な操作の隣に並べると押し間違える物を奥にしまう。`label` は「<名前> の操作」。押す所は 44px 角(手袋・親指)。戻せない項目は `isDestructive`(赤い文字)で、選んだ後に `ConfirmDialog` |
| `EmptyState` | 空のとき | 何が無いか(`title`)+何をすれば増えるか(`description`)+その場の操作(`action`)。見るだけの人には、誰ならできるかを書く。絞り込みで空なら、絞り込みを外せばよいと書く |
| `ToastProvider` / `useToast` | 操作の結果を短く知らせる | 読み上げにも届く。大事なエラーはトーストにせず画面に残す。**戻せる操作(完了にするなど)は、確認より「元に戻す」**(`show(文, { action })`。`useAction` の `undo`)。操作つきは 8秒出す |
| `Alert` | 画面に残すお知らせ(ログインの失敗など) | トーストと違って消えない。`danger` は出たときに読み上げる。色だけでなく文で伝える |
| `Badge` | ロール・状態の札 | 色だけで意味を伝えない(必ず文字) |
| `QrCode` | 二段階認証の設定(認証アプリに読ませる) | ブラウザの中で描く(外のサービスに値を送らない)。読めない人のため、同じ値を文字でも出す。暗いテーマでも黒地にしない(`--color-qr-*`) |
| `Page` / `Stack` / `Inline` / `Card` / `Heading` / `Text` / `Muted` | 並べる・囲む・見出し・段落 | 間は `gap`(余白のトークン)。見出しは文書の構造に合わせて `level` |

使い方の例は `apps/web/src/pages/` を見る。`Link` は `apps/web/src/routes/__root.tsx` の `LinkRouterProvider` でルーターにつないである。

## 使い方の決まり

1. 画面(`apps/web`)では `@app/ui` から import する。`react-aria-components` を直接使わない。
2. 見た目は部品の props(`variant`・`size`・`gap`・`tone`)で決める。`style={...}` や `className` を画面で書かない。
3. 足りないときは、画面で工夫せずに `packages/ui` に部品か props を足す(下の手順)。
4. ボタン・入力・一覧には、必ず見える名前か `aria-label` を付ける(E2E の axe が確かめる)。
5. **枠の線は2つを使い分ける。** 入力欄・選択・チェックボックス・副のボタンなど、操作する部品の枠は `--color-border-control`(背景と面に 3:1 以上。WCAG 2.2 の 1.4.11)。区切りの線・カード・表・一覧など飾りの線は `--color-border`。新しい部品の枠も、押す・書く・選ぶ所を見分ける線なら `--color-border-control`([仕様 0037](specs/0037-control-border-contrast.md))。
6. **幅 320px(いちばん狭いスマホ)で、画面全体が横にはみ出さない。** 部品に固定の幅を付けるときは `min(<幅>, 100%)` にする。中身が広くなる物(表など)は、部品の中に横に動く枠を持つ。押す所は 24px 以上(WCAG 2.2)。

## 部品を足す手順

1. **本当に新しい部品か**確かめる。既存の部品の props を1つ足せば済むなら、そちらにする。
2. React Aria Components に土台があるか見る([部品の一覧](https://react-spectrum.adobe.com/react-aria/components.html))。あれば包む。無ければ HTML の正しい要素(`button`・`ul` など)で作る。
3. `packages/ui/src/components/<名前>.tsx` に書き、`packages/ui/src/index.ts` から export する。
4. 見た目は `packages/ui/src/styles.css` に、クラス名 `ui-<名前>` で。値は必ずトークン(`var(--...)`)。状態は React Aria が付ける `data-hovered`・`data-selected`・`data-focus-visible` などで書き分ける。
5. 部品の一覧ページ(`apps/web/src/pages/DesignSystemPage.tsx`)に並べる。
6. 画面で使い、E2E を回す(axe が問題を拾う)。キーボードだけで操作できるかを手で1回確かめる。
7. 見た目の基準を撮り直す(`pnpm vrt:update`)。変わった画像を見てからコミットする([guides/vrt.md](guides/vrt.md))。
8. この表(何があるか)に1行足す。

**新しい色や余白が要るとき**は、トークンを足す提案を PR の「人に判断してほしい所」に書く(トークンを決めるのは人)。

**ブランドの色(主な色)を決める・変えるとき**は `/brand`。約束(`docs/product/positioning.md`)と相手から案を出し、`pnpm contrast` の比を添えて、`tokens.css` を置き換えた PR にする(理由は `docs/product/brand.md`)。

## 人と AI の分担

| | 人(デザイナー・プロダクトの人) | AI |
|---|---|---|
| ブランドの色・文字・余白(トークン) | 決める(約束の後。`/brand` の PR を VRT のスクショで見て) | 案を出す・コントラストを計算する(`pnpm contrast`)・トークンの PR を作る |
| 部品の種類と振る舞い | 決める(何が要るか・どう動くべきか) | 作る・テストする |
| 画面 | 受け入れ条件と、見本の絵(あれば) | 部品を組み合わせて作る |
| アクセシビリティ | キーボードと読み上げで最後に触って確かめる | axe を通す・名前とラベルを付ける |
| 使いやすさ | 🎨 の ❓(利用者の挙動の思い込み・新しい色や余白)を決める | 🎨 のレビュー役が画像を見て所見を出し、❌・⚠️ を部品の中で直す |

## 確かめる仕組み

| 何を | どうやって | いつ |
|---|---|---|
| 生の色・直書きのスタイル・画面の CSS | Semgrep(`.semgrep/design/`、テストつき) | 毎 PR(`ci.yml`) |
| トークンの色の組ごとのコントラストの比(明るいテーマ・暗いテーマ。文字 4.5:1・フォーカスの枠など 3:1) | `pnpm contrast`(`scripts/contrast-lib.mjs`。いまの `tokens.css` が届くかは `pnpm test:scripts` のテスト) | 色の案を出すとき(`/brand`)・毎 PR(`ci.yml` の fast) |
| 色のコントラスト・ラベル・名前の漏れ・押す所の大きさ | axe(E2E の各画面。WCAG 2.2 AA まで) | 毎 PR(`ci.yml` の E2E) |
| スマホの幅で横にはみ出さない | E2E の `expectAccessible`(`scrollWidth <= clientWidth`)。スマホの組(幅 320px)は主な流れと、表・入力の画面を見て回る `narrow-screens.spec.ts`(`playwright.config.ts`) | 毎 PR(`ci.yml` の E2E) |
| 見た目が前と変わっていないか(部品の一覧と主な画面。パソコン・スマホの幅) | VRT(`pnpm vrt`。Docker の中の Chromium で撮り、基準の画像と比べる。[guides/vrt.md](guides/vrt.md)) | 毎 PR(`vrt.yml`。結果と画面は PR のコメントに) |
| キーボードだけで使えるか・読み上げの順番 | 人が触る | 危険度「中」以上の画面の変更 |
| 迷わないか・押し間違えないか・失敗して戻れるか(画面の状態・強弱・文言・危ない操作) | 🎨 使いやすさを見る人(`/review-pr` のレビュー役が、変わる前と後の画面の画像を見る。見方は [guides/ux-review.md](guides/ux-review.md)) | 画面を変える PR(危険度によらず) |

## 部品の一覧ページ

`/design-system`(手元なら http://localhost:8080/design-system)に、全部の部品を種類ごとに並べてある(ログイン無しで開ける。**本番では出ない**)。
部品を足したら、ここにも並べる。見た目の回帰テスト(VRT)がこのページをパソコンとスマホの幅で撮るので、部品の CSS を変えると、どこが変わったかが PR に出る。
Storybook などの見本の道具は入れていない(見るのと撮るのは、このページで足りる。[設計書 0011](designs/0011-visual-regression.md))。
