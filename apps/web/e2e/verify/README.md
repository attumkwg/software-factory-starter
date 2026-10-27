# PR の動作確認の手順(コミットしない)

`/verify-pr` が PR の「🖱 動作確認」の欄を読んで、ここに `pr-<番号>.spec.ts` を書いて流す。手順は PR のコメントに貼り、ファイルはコミットしない(`.gitignore`)。

- 書き方: `../verify-fixture.ts` の `test` と `expect` を使う(画面のエラー・失敗した通信・API の直叩きを記録する)。部品は `../helpers.ts`(ログイン・アクセシビリティ)と、ふだんの E2E の流れ。
- 流す前に `pnpm verify:lint apps/web/e2e/verify/pr-<番号>.spec.ts`(危ない書き方を止める。1層目)。
- 流した後は、通っても記録とトレースを疑って読む(2層目)。見る所は `docs/guides/verify-pr.md`。
