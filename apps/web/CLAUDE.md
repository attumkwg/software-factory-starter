# apps/web のルール

TanStack Start の SSR(サーバーで HTML を作り、ブラウザで同じものを動かす)。API とは別のサービス(ADR 0003)。

## 画面の作り方

- 画面と URL は `src/routes/` に置く(ファイルの場所が URL になる)。ログインが要る画面は `src/routes/_app/` の下。
- データは route の `loader` で読む(SSR でもブラウザの移動でも同じ関数が動く)。画面の中で `useEffect` で取りに行かない。
- 書き込み(作る・直す・消す)は **`useAction`(`src/use-action.ts`)を通して**ブラウザから送る。成功したら読み直し、失敗したら理由を出し、401 ならログイン画面へ回す(Semgrep が止める)。**SSR から書き込まない**(`api.ts` が止める)。
- 読む失敗は投げるだけ(画面の受け皿が出す)。利用者への文は `src/messages.ts` の1か所(固定の文だけ・どこが違ったかを言わない)。決まりは `docs/guides/error-handling.md`。
- 絞り込みなど「共有・再読み込みで残したい状態」は URL の search に持つ(`validateSearch`)。**メールアドレスなどの個人の情報は URL に載せない**(履歴・ログに残る。ログイン・登録は画面の中で段を進める)。
- ログイン・登録・再設定の画面(`pages/LoginPage.tsx` など)は `pages/auth/` の入力欄と `useSubmit` を使う。文は `messages.ts` の固定の文(どこが違ったか・登録の有無を言わない)。
- `src/routeTree.gen.ts` は自動で作られる。手で直さない(`pnpm dev` か `pnpm build` で作り直す)。

## SSR で気をつけること

- 描くとき(コンポーネントの本体)に `window` / `document` / `localStorage` を触らない。サーバーには無い。要るなら `useEffect` の中か `<ClientOnly>`。
- 日時は `src/format.ts` を通す(サーバーは UTC なので、そのまま出すと読み込み直後に表示がずれる)。
- 秘密を画面のコードに書かない。`VITE_` で始まる環境変数はブラウザに出る。画面のサーバーは秘密を持たない決まり。

## 見た目・API・認可

- 画面は `@app/ui`(packages/ui)の部品だけで作る。生の色コード・`style={...}`・画面ごとの CSS は書かない(Semgrep が止める)。足りなければ packages/ui に足す(`docs/design-system.md`)。ページの移動は `Link`、押す操作は `Button`。
- API は `src/api.ts` からだけ呼ぶ。型は `@app/shared` を使い、画面で型を作り直さない。
- 認証は同じオリジンの HttpOnly Cookie。トークンを localStorage / sessionStorage に置かない。
- ボタンの出し分けは `src/permissions.ts`。**守りは API 側**なので、画面で隠すだけで安心しない。

## テスト

- E2E(`e2e/`)は種データの2社(Acme / Globex)を使う。要素は役割と名前で取る(`getByRole` / `getByLabel`)。
- 大事な流れを変えたら E2E を1本足すか直す(目安: 大事な流れ5本程度まで)。
- 本番の Node サーバー(`server/`)を変えたら `server/app.test.ts` も直す。

## 速さ

- 画面の JS・CSS の大きさに上限がある(CI が `pnpm --filter @app/web size` で見張る)。重いライブラリを足す前に、要る画面でだけ読み込めないか考える。上限と超えたときの考え方は `docs/guides/ci-limits.md`。
- ALB は圧縮しないので、画面のサーバーが圧縮する(JS・CSS はビルドのときに `.br` / `.gz` を作る・HTML はその場で塊ごとに)。`server/compress.ts` を通さずに応答を返さない。
