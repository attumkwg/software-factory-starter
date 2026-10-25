# 守りの3層(AI に勝手に変えさせない所)

危険度「高」の場所(認証・認可・DB・移行・権限の表・infra・CI・ハーネス・検査の除外・依存の入れ方)は、AI が人の確認なしに変えない。一覧は `.claude/hooks/protected-paths.json` の1つだけで、ほかはこれに合わせる(`pnpm guards` が CI で見張る)。

| 層 | 何が | 止めるもの | 止められないもの |
|---|---|---|---|
| ① 手元の Claude Code | `.claude/settings.json` の `deny` と、編集のフック `.claude/hooks/guard-edit.mjs`・Bash のフック `.claude/hooks/guard-bash.mjs` | 一覧の場所の Edit・Write(確認が出る)・それを Bash で書き換えるコマンド(確認が出る)・main への push・強制 push・ブランチの削除・マージ・承認(止める) | スクリプトの中で書く・変数で組み立てた道。人が確認で「はい」と押したもの |
| ② GitHub | ブランチ保護(PR 必須・CI 必須・最新に追いついてから)・CODEOWNERS・Environments | ①をすり抜けた変更が main と本番に入ること | 設定していなければ何も止めない |
| ③ 人 | PR の `risk:high` ラベル(`labeler.yml`)・「人に判断してほしい所」・`/security-review` | 中身の誤り | 見ていない PR |

- 自動(auto)モードでもフックの確認は出る(フックの `ask` は自動モードより強い)。
- フックは「読むだけ」のコマンド(`cat`・`grep`・`git diff` など)は聞かない。疑わしいときは聞く側に倒してある。止めすぎ・聞きすぎを見つけたら、`guard-edit.test.mjs`・`guard-bash.test.mjs` に例を足してから直す。

## 編集の確認を手元だけで外す(`KIT_EDIT_GUARD=pr`)

並べたセッションで infra や `.github` に触るたびに止まり、確認が「最後に人が見るべき所」でなくなるときは、**使う人の手元だけで**一覧の場所の確認を外せる。キットの既定(`.claude/settings.json`)は変えない(ADR 0034)。

手元の設定の `env` に1行書く:

```json
{ "env": { "KIT_EDIT_GUARD": "pr" } }
```

| 書く所 | 効く範囲 | git |
|---|---|---|
| `~/.claude/settings.json` | 自分のすべてのリポジトリ・すべての worktree | 載らない |
| `.claude/settings.local.json` | そのチェックアウトだけ(新しく作った worktree には無い) | 載らない(`.gitignore`) |

worktree を使う(並べたセッション)なら `~/.claude/settings.json` の方が効く。

- 外れるのは、一覧の場所の **Edit・Write・MultiEdit・NotebookEdit と、Bash での書き換えの確認だけ**。そのときは確認の代わりに「PR の危険度と人に判断してほしい所で確かめる」と出て、ふだんの権限の扱い(手元の権限のモード)に従う。
- **外れないもの**: `deny`(`terraform apply`・`aws`・`.env` を読む・`gh pr merge`・main への push・強制 push・ブランチの削除・承認)。`.claude/settings.json` を書くときの Claude Code そのものの確認。
- 外したときは、**PR の段が最後の確認**になる: `risk:high` のラベル(`labeler.yml` が自動で付ける)・CODEOWNERS・PR 本文の「⚠️ 危険度」と「人に判断してほしい所」。AI は一覧の場所を変えたら危険度を「高」にし、何を・なぜ変えたかを「人に判断してほしい所」に書く。
- `pr` 以外の値(空・`off` など)は外れない(既定のまま聞く)。
- 戻すときは、その1行を消す。
- **② が無い(非公開+Free)ときは外さない**。PR の段に CODEOWNERS とブランチ保護が無いので、最後の確認が無くなる。

## ⚠️ ② は GitHub のプランで変わる

| リポジトリ | ブランチ保護・ルールセット | Environments(main だけ・秘密) | Environments の承認者 | push 保護 | Actions の分数 |
|---|---|---|---|---|---|
| 公開 | ✅ | ✅ | ✅ | ✅ 無料 | 無料・上限なし |
| 非公開+Free | ❌ | ❌ | ❌ | ❌(有料) | 月 2,000分 |
| 非公開+Pro / Team | ✅ | ✅ | ❌ | ❌(有料) | 月 3,000分 |

**非公開+Free のままだと ② が丸ごと無い**。そのときは:

- ① だけが守り。`.claude/settings.json` とフックを外さない・弱めない(`KIT_EDIT_GUARD=pr` も書かない)。
- `deploy.yml` の prod の承認と、`claude.yml` の「API キーは main だけ」は働かない。AWS と Claude の鍵を入れる前に、公開にするか Pro / Team にする。
- 並べて出した PR は、それぞれが古い main で緑でも、合わせると main が赤くなることがある(2026-10-20 に2回)。マージの前に main を取り込んで CI を回し直す。

## 一覧に場所を足すとき

1. `.claude/hooks/protected-paths.json` に足す。
2. `pnpm guards` を回すと、足りない所(`labeler.yml` の `risk:high`・`CODEOWNERS`)が出る。全部に足す。2つのフックは一覧をじかに読むので、足さなくてよい(`settings.json` の `ask` には書かない。書くと手元で外せなくなり、`pnpm guards` が落ちる)。
3. この PR 自体が危険度「高」。人が見てマージする。
