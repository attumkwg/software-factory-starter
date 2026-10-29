# 公開の前の点検(キット)

> キットのリポジトリを公開する前・版を切る前に見る物。**外に出して困る物が無いか**を、毎回同じ見方で確かめる。
> 1回目は 2026-10-29(公開までの道のり [roadmap.md](roadmap.md) の ③・G-108)。版の付け方と切る手順は [maintenance.md](maintenance.md) の 4。
> 履歴は書き換えない(書き換えると、キットから作ったリポジトリの取り込みが壊れる)。履歴に残る物は、ここに記録して持ち主が判断する。

## 1. 見る物と見方

| 見る物 | 見方 | 2026-10-29 の結果 |
|---|---|---|
| 秘密(鍵・トークン・パスワード) | gitleaks を履歴ごと(CI と同じ版。PR の枝 `refs/pull/*/head` も取ってきて `--log-opts=--all`) | 0件(main と PR の枝。誤検知は `.gitleaksignore` の1件だけ) |
| 依存のライセンス | `pnpm deps:licenses`([licenses.md](../compliance/licenses.md)) | 入れない物(GPL・AGPL など)0件。注意 5件は理由つき |
| 個人・会社が分かる記述 | `git grep` で、作者の私用のメール・本名・手元のパス・AWS のアカウント ID・Slack の ID・Webhook の URL。履歴は `git log -S` | ファイルの中には無い(例は `*.test`・`example.com`・`123456789012`)。コミットの作者名は下の 2 |
| キットの外の話 | `pnpm self-contained`(CI)。履歴は `git log -S` | 今のファイルには無い。履歴に、作者の非公開の資料を指すパスの名前が7コミット(2026-10-17〜10-22。中身は写っていない。b1e20ad で消した) |
| 見本の題材が架空と分かるか | 台本([../scenarios/companies.md](../scenarios/companies.md))・見本のデータ(Acme・Globex・Initech と `*.test` のメール)・公開ページの運営者 | 台本と公開ページは「架空」と書いてある。見本のデータは [getting-started.md](../getting-started.md) の ① に1行足した |
| 消したファイル | `git log --diff-filter=D --name-only` で `.env`・鍵・メモが無いか | 無い |

## 2. 履歴に残る物(書き換えない。持ち主が判断する)

- 👤 **コミットの作者名**: main のコミット(Renovate の物を除く全部)の作者名が、持ち主の名前(メールは GitHub の noreply)。公開すると誰でも読める。**このまま公開する**(@attumkwg 2026-10-29 会話で回答。履歴は書き換えない)。
- 🗄 **非公開の元のリポジトリ**(作り直す前の履歴): 私用のメールの入ったコミットと、作り直す前の誤検知(`.gitleaksignore` の注の `ddc64f2`)が残る。**非公開のまま**にする。キットの CI(`pnpm self-contained`)は、その名前を指す文を落とす。
- 🔗 キットの中の検査(`scripts/self-contained-lib.mjs`)は、指してはいけない外の名前を一覧に持つ。公開すると、その名前(非公開のリポジトリがあること)は読める。中身は読めない。

## 3. 持ち主がやること(AI はしない)

| 何を | 決め方・やり方 |
|---|---|
| `v0.1.0` のタグを打つ | **告知する日に**(@attumkwg 2026-10-29。設計書 0066 の U-3。リポジトリはもう公開なので、公開の再確認で出た物を直したら告知する、と @attumkwg が 2026-10-29 に決めた)。[CHANGELOG.md](../../CHANGELOG.md) の「未リリース」に下書きがある。切る手順は [maintenance.md](maintenance.md) の 4 |
| リポジトリを公開にする | GitHub の Settings で持ち主が。公開の後、Security → Private vulnerability reporting が有効か確かめる(`.github/setup.yml` で有効にしている) |

最終更新: 2026-10-29
