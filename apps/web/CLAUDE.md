# apps/web のルール

- 画面は `@app/ui`(packages/ui)の部品だけで作る。生の色コード・`style={...}`・画面ごとの CSS は書かない(Semgrep が止める)。足りなければ packages/ui に足す(`docs/design-system.md`)。
- API は `src/api.ts` からだけ呼ぶ。型は `@app/shared` を使い、画面で型を作り直さない。
- 認証は同じオリジンの HttpOnly Cookie。トークンを localStorage / sessionStorage に置かない。
- ボタンの出し分けは `src/permissions.ts`。**守りは API 側**なので、画面で隠すだけで安心しない。
- E2E(`e2e/`)は種データの2社(Acme / Globex)を使う。要素は役割と名前で取る(`getByRole` / `getByLabel`)。
- 大事な流れを変えたら E2E を1本足すか直す(目安: 大事な流れ5本程度まで)。
