# ADR 0034: 危険度「高」の場所の編集の確認は、フックで出す。使う人が手元だけで外せる(KIT_EDIT_GUARD=pr)

- 状態: 採用(手元だけで外す形は、2026-10-25 に持ち主が決めた)
- 日付: 2026-10-25
- 決めた人: @attumkwg

## 背景

危険度「高」の場所(`.claude/hooks/protected-paths.json`)を Claude Code が書くときの確認は、`.claude/settings.json` の `permissions.ask`(場所ごとの Edit・Write)と Bash のフック `guard-bash.mjs` が出していた。`ask` は自動(auto)モードより強く、並べたセッションで infra や `.github` に触るたびに作業が止まる。確認が多すぎて、人が「最後に見るべき所」を見る確認になっていなかった。

`settings.json` の `ask` は、使う人の手元の設定(`~/.claude/settings.json`・`.claude/settings.local.json`)からは外せない(設定は合わさり、`ask` は手元の `allow` より先に効く)。キットは公開のひな形なので、既定を弱めて全員の守りを外すことはしない。

## 選択肢

| 案 | 良い所 | 弱い所 |
|---|---|---|
| A. 今のまま(`ask`) | 守りは強い | 並べたセッションが止まり続ける。手元で外せない |
| B. キットから `ask` を消す | 止まらない | 使う人全員の既定が弱くなる |
| C. `ask` をフック(`guard-edit.mjs`)に置き換え、手元の `env` の `KIT_EDIT_GUARD=pr` のときだけ確認を出さない | 既定は今と同じ確認。外すのは使う人の手元だけで、git に載らない | フックが道を読み違えると確認が抜ける(テストで見張る)。外した人は PR の段だけが最後の確認になる |

## 決めたこと

- **C**。編集のフック `guard-edit.mjs`(Edit・Write・MultiEdit・NotebookEdit)が一覧に当たる場所なら `ask` を返す。`KIT_EDIT_GUARD=pr` のときは確認を返さず、「PR の危険度と人に判断してほしい所で確かめる」と見せて、ふだんの権限の扱いに戻す(`allow` は返さない。手元の権限のモードより弱くしない)。
- Bash のフック `guard-bash.mjs` も同じ変数で、一覧の場所の書き換えの確認だけを外す。`deny`(`terraform apply`・`aws`・`.env` を読む・`gh pr merge`・main への push・強制 push・ブランチの削除・承認)は変数に関係なく止める。
- `pr` 以外の値は外れない。一覧は `protected-paths.json` の1つのままで、2つのフックがじかに読む。`settings.json` の `ask` に Edit・Write を書き戻すと手元で外せなくなるので、`pnpm guards` が落とす。
- 外したときの最後の確認は PR の段(`risk:high` のラベル・CODEOWNERS・PR 本文の「⚠️ 危険度」「人に判断してほしい所」)。手引きは `docs/guides/local-guards.md`。

## 結果として起きること

- 良くなること: 既定の守りは今と同じまま、外したい人は1行で並べたセッションを止めずに回せる。一覧に場所を足すとき、`settings.json` に2行ずつ足さなくてよい。
- 我慢すること: 確認がフックの道の読み方に頼る(worktree の中・Windows の道・大文字小文字はテストで見る)。外した人の手元では、一覧の場所の変更に気づくのが PR になってから。
- 見直す合図: 外した手元から、危険度「高」の変更が「人に判断してほしい所」に書かれずに PR に出た(→ PR の段の見張りを足すか、外し方を狭める)/ Claude Code の設定で手元から `ask` を外せるようになった(→ フックをやめて `ask` に戻すか考える)。
