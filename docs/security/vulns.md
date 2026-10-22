# 脆弱性の精査の記録

> `/cve` が精査した結果のうち、**書いてよいものだけ**を1件1行で残す。決まりは [guides/vulnerabilities.md](../guides/vulnerabilities.md)。
> `pnpm vulns` が Dependabot の開いている通知とこの表を突き合わせ、精査していない通知と見直す日が来た行を出す。

- **書いてよいのは**: 該当なし・入っているが届かない・届く(直した PR がマージされた後)。
- **書かない**: 届く・まだ直していない穴。公開のリポジトリなので、直す前に穴の場所を知らせることになる。精査と方針は GitHub の非公開の Security Advisory の下書きに置き、直してから「届く・直した」の行を足す。
- **足すだけ**。見直したら、同じ ID で新しい行を足す(いちばん新しい行が今の結論)。
- 結果は `該当なし` / `入っているが届かない` / `届く・直した` のどれか。`入っているが届かない` には見直す日が要る(それ以外は `—` でよい)。
- 理由には、精査の6段のどこで分かれたか(入っていない・版が外れ・開発用だけ・穴のある使い方をしていない・外から届かない)と、確かめたこと(`pnpm why` の道・検索した呼び出し)を短く。

| 日付 | ID | パッケージ | 結果 | 理由 | 見直す日 |
|---|---|---|---|---|---|
| 2026-10-22 | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | esbuild ≤0.24.2(中) | 入っているが届かない | 入っている esbuild は 0.18.20・0.25.12・0.28.2 で、範囲に当たるのは 0.18.20 だけ。道は `@app/api` の devDependencies の `drizzle-kit` 0.31.11 → `@esbuild-kit/esm-loader` 2.6.5 → `@esbuild-kit/core-utils` 3.3.2 → esbuild 0.18.20(`pnpm why esbuild -r`)。`drizzle-kit` は手元で移行を作る `db:generate` だけで使い、本番のイメージ(`apps/api/Dockerfile` の実行用)には束ねた `dist` しか入らない。穴は開発サーバー(`serve`)の CORS で、キットのコードは esbuild の `build` しか呼ばず `serve` を使っていない。Dependabot は scope を runtime と出すが、pnpm の間接の開発用の依存を見分けられないため。`drizzle-kit` が `@esbuild-kit` を外した版に上がれば消える(それより前に見直す日が来たら、もう一度) | 2027-01-22 |
