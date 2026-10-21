# 守りの3層(AI に勝手に変えさせない所)

危険度「高」の場所(認証・認可・DB・移行・権限の表・infra・CI・ハーネス・検査の除外・依存の入れ方)は、AI が人の確認なしに変えない。一覧は `.claude/hooks/protected-paths.json` の1つだけで、ほかはこれに合わせる(`pnpm guards` が CI で見張る)。

| 層 | 何が | 止めるもの | 止められないもの |
|---|---|---|---|
| ① 手元の Claude Code | `.claude/settings.json` の `deny`・`ask` と、Bash のフック `.claude/hooks/guard-bash.mjs` | 一覧の場所の Edit・Write(確認が出る)・それを Bash で書き換えるコマンド(確認が出る)・main への push・強制 push・ブランチの削除・マージ・承認(止める) | スクリプトの中で書く・変数で組み立てた道。人が確認で「はい」と押したもの |
| ② GitHub | ブランチ保護(PR 必須・CI 必須・最新に追いついてから)・CODEOWNERS・Environments | ①をすり抜けた変更が main と本番に入ること | 設定していなければ何も止めない |
| ③ 人 | PR の `risk:high` ラベル(`labeler.yml`)・「人に判断してほしい所」・`/security-review` | 中身の誤り | 見ていない PR |

- 自動(auto)モードでも `ask` とフックの確認は出る(Claude Code の決まり)。確認が多いと感じても、一覧の場所は外さない。
- フックは「読むだけ」のコマンド(`cat`・`grep`・`git diff` など)は聞かない。疑わしいときは聞く側に倒してある。止めすぎ・聞きすぎを見つけたら、`guard-bash.test.mjs` に例を足してから直す。

## ⚠️ ② は GitHub のプランで変わる

| リポジトリ | ブランチ保護・ルールセット | Environments(main だけ・秘密) | Environments の承認者 | push 保護 | Actions の分数 |
|---|---|---|---|---|---|
| 公開 | ✅ | ✅ | ✅ | ✅ 無料 | 無料・上限なし |
| 非公開+Free | ❌ | ❌ | ❌ | ❌(有料) | 月 2,000分 |
| 非公開+Pro / Team | ✅ | ✅ | ❌ | ❌(有料) | 月 3,000分 |

**非公開+Free のままだと ② が丸ごと無い**。そのときは:

- ① だけが守り。`.claude/settings.json` とフックを外さない・弱めない。
- `deploy.yml` の prod の承認と、`claude.yml` の「API キーは main だけ」は働かない。AWS と Claude の鍵を入れる前に、公開にするか Pro / Team にする。
- 並べて出した PR は、それぞれが古い main で緑でも、合わせると main が赤くなることがある(2026-10-20 に2回)。マージの前に main を取り込んで CI を回し直す。

## 一覧に場所を足すとき

1. `.claude/hooks/protected-paths.json` に足す。
2. `pnpm guards` を回すと、足りない所(`settings.json` の `ask`・`labeler.yml` の `risk:high`・`CODEOWNERS`)が出る。全部に足す。
3. この PR 自体が危険度「高」。人が見てマージする。
