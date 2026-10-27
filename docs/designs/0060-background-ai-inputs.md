# 設計: 背景の AI に読ませる文章の書き手を確かめ、秘密を見せない・書かせない

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0060-background-ai-inputs.md](../specs/0060-background-ai-inputs.md)
> 状態: 下書き
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

背景の AI のワークフロー(`claude.yml`)を3つの段にする。① 前の段 `authors`(秘密なし)が、頼まれた Issue・PR の本文・コメント・レビューの書き手を確かめる。② `claude` は、Bash などのサブプロセスから秘密を消し(`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`+bubblewrap)、外へ書く文章の秘密の形をフック(`guard-secrets-out.mjs`)で止めて動く。③ 後ろの段 `output-secrets`(秘密なし)が、動いた間に書かれた本文とコメントを gitleaks で見る。

## 作業の前に読んだ物(ガイド)

- `.github/workflows/claude.yml`(起動の条件・権限・道具の一覧)・`docs/guides/unattended-ai.md`・`docs/security.md` の AI-2・AI-3・設計書 0057(外へ出す手段)
- claude-code-action v1.0.252(`claude.yml` で固定している版)の公開のソース: `action.yml`(`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` はワークフローかジョブの `env` か、`allowed_non_write_users` があるときに入る。bubblewrap はそのときだけ入れる)・`src/entrypoints/run.ts`(`GITHUB_TOKEN`・`GH_TOKEN` を自分の環境に入れる)・`src/github/operations/git-config.ts`(`allowed_non_write_users` が無いと、リモートの URL にトークンを書く)・`src/github/validation/permissions.ts`(確かめるのは起動した人だけ)・`src/github/token.ts`(OIDC でアプリのトークンに替える。`id-token: write` が要る)・`docs/security.md`
- Claude Code の公開の文書(環境変数の一覧の「What the subprocess environment scrub removes」): `ANTHROPIC_API_KEY`・`AWS_SECRET_ACCESS_KEY`・名前や値が鍵らしい物は消す。`GITHUB_TOKEN`・`GH_TOKEN` は `gh` のために残す。Linux では Bash を別の PID の空間で動かす
- `scripts/review-count-lib.mjs`(書き込める人の数え方。同じ区分を使う)・`.claude/hooks/guard-bash.mjs`・`record-outbound.mjs`(フックの型)・`scripts/check-guards.mjs`
- `.github/workflows/ci.yml` の gitleaks(固定した版のイメージ)

## 1. 設計方針

- **読ませる文章を絞る・読んだ後に動ける手段を減らす・出力を機械で見る、の重ね掛け**(台本 10-1 の「世の中では」)。どれか1つに頼らない。
- 書き手の確かめは、秘密を持たない別のジョブ(`authors`)にする。AI のジョブは `needs: authors` で、落ちたら動かない。
- 起動の条件(持ち主だけ)は `authors` の `if` に移す。`claude` と `output-secrets` は `authors` の結果に従う。
- 秘密を消すのは Claude Code の機能(`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`)を使う。自分で `env` を消す仕組みは作らない(Claude Code の本体は鍵が要る)。
- 外へ書く文章の秘密は、書く前(フック)と書いた後(gitleaks)の2か所で見る。書く前は崩した値を見逃し、書いた後は取り消せないので、両方置く。

## 2. データモデル

該当なし(DB を使わない)。

## 3. API

該当なし(アプリの API は変えない)。GitHub の REST を `gh api` で読むだけ:

- 前の段: `issues/{n}`(本文の書き手と区分。PR なら `pull_request` がある)・`issues/{n}/comments`・`pulls/{n}/reviews`・`pulls/{n}/comments`。ページは `--paginate --slurp` で全部。
- 後ろの段: `issues?state=all&since=`(Issue と PR の本文。直された物も)・`issues/comments?since=`・`pulls/comments?since=`。

## 4. 状態遷移

該当なし(ジョブの順だけ: `authors` → `claude` → `output-secrets`。`output-secrets` は `claude` が落ちても `authors` が通っていれば流れる)。

## 5. システム間連携

- 前の段の権限: `contents: read`・`issues: read`・`pull-requests: read`。`GITHUB_TOKEN` だけ。Environment なし。頼む文・番号は `env` で渡す(式を run に書かない)。
- AI のジョブ: 権限は今のまま(`contents`・`pull-requests`・`issues` の write・`id-token: write`・`actions: read`)。`id-token: write` は action が OIDC で Claude のアプリのトークンに替えるのに要る(`GITHUB_TOKEN` で PR を出すと、その PR で CI が流れない)。
- 後ろの段の権限: `issues: read`・`pull-requests: read`。gitleaks は ci.yml と同じ固定の版のイメージを `dir` で使う(読み取り専用でマウント)。
- bubblewrap は Ubuntu の apt から入れる(action の `allowed_non_write_users` のときと同じ物と同じ手順)。

## 6. 業務ルール

- 信じる書き手: `author_association` が OWNER・MEMBER・COLLABORATOR。ボット(`user.type === "Bot"`)は `github-actions[bot]`・`claude[bot]` だけ(中身をこのリポジトリのワークフローが書く)。Renovate・Dependabot は上流のリリースノートを本文に写すので信じない。消えたアカウントは信じない。
- 見る文章: 本文・コメント・レビュー(本文が空なら読む文章が無いので見ない)・行のコメント。
- 確かめる番号: 手動の起動は頼む文の `#数字`・`/issues/数字`・`/pull/数字`。`issue_comment`・`issues` はその番号も。1回 10 個まで。
- 外へ書く文章の秘密の形: Anthropic の API キー・GitHub のトークン(`gh[pousr]_`・`github_pat_`)・AWS のアクセスキー・秘密鍵・JWT・Slack のトークン、と、いまの環境の `GH_TOKEN`・`GITHUB_TOKEN` の値そのものと base64。見るのは外へ書く `gh`(`issue`・`pr` の comment・create・edit・review・close・reopen・`release`・`gist create`・`api`)と、本文を読むファイル(`--body-file`・`--input`・`-F key=@file`)と、MCP の道具の引数の全部。
- フックは `KIT_EDIT_GUARD` に関係なく止める(手元でも、秘密を外へ書く理由は無い)。

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 書き込めない人の文章があれば動かない | 1・6 | `.github/scripts/ai-input-authors.test.mjs`(信じる書き手・拾う文章・判定) |
| 前の段は秘密を持たない | 5 | `claude.yml` の `authors`(読んで確かめる・CI の zizmor) |
| 番号なしは通す・多すぎれば止める | 6 | 同(判定) |
| サブプロセスから秘密を消す・bubblewrap | 1・5 | `claude.yml` の `env` と手順(本物の鍵では試していない。8 の「確かめられないこと」) |
| 外へ書く文章の秘密をフックで止める | 6 | `.claude/hooks/guard-secrets-out.test.mjs`(`pnpm guards`)・`check-guards.mjs` が settings.json に付いているかを見る |
| 動いた後に gitleaks で見る | 1・5 | `claude.yml` の `output-secrets`(CI の actionlint・zizmor) |

## 8. 非機能

- 性能: 前の段は API を番号ごとに3〜4回・5分で打ち切り。後ろの段は API 3回と gitleaks で1〜2分。
- セキュリティ: 仕様の STRIDE のとおり。
- 運用: 前の段で止まったら、出力に番号・種類・書き手・直し方(自分の言葉で書き直す)を出す。後ろの段で見つかったら `secret-leak.md` へ。
- 費用: Actions の分数が、AI を動かすたびに2〜3分増える。
- 確かめられないこと: 秘密が本当に Bash から見えないかは、本物の API キーを入れて動かさないと確かめられない(本物で試さない)。持ち主が最初に動かすとき、Actions のログの「Run Claude Code Action」の環境に `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: 1` があること、bubblewrap の手順が通ったことを見る(`unattended-ai.md`)。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離 | 該当なし |
| 権限の表 | 該当なし |
| 監査ログ | 該当なし(Actions のログに止めた理由が残る) |
| 解約で消す一覧 | 該当なし |
| サポートの代理ログイン | 該当なし |
| ログの個人情報 | GitHub のユーザー名と番号だけを出力に出す。止めた秘密の値は出さない(gitleaks は `--redact`) |
| 列の分類(`personal` / `sensitive`) | 該当なし |
| 画面の部品 | 該当なし |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 最重要 | 背景の AI の入口と出口。どの段に秘密を持たせるか |
| データモデル | 低優先 | 該当なし |
| API | 低優先 | GitHub を読むだけ |
| 状態遷移 | 軽く確認 | ジョブの順だけ |
| システム間連携 | 最重要 | 権限・Environment・action の振る舞い |
| 業務ルール | 最重要 | 誰の文章を信じるか・何を秘密とみなすか |
| 要求との対応 | 機械で検証 | 単体テスト・`pnpm guards` |
| 非機能 | 採用 | 本物の鍵で確かめられない所を手順に残す |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- **外の人の文章が1つでもあれば止める**(要約して渡す・その文章だけ外す、にしない) — 要約する AI も指示を読む。外すと、何が抜けたかを AI も人も知らずに作業する。直し方は「人が読んで、自分の言葉で書き直す」。
- **コメントとレビューも見る**(本文だけにしない) — `@claude` の起動では action がコメントも AI に渡し、手動では `gh issue view --comments` で読める。
- **Renovate・Dependabot の PR は信じない** — 本文に上流のリリースノートが入る。依存の更新の PR を背景の AI に直させたいときは、人が Issue を書いて頼む。
- **前の段・後ろの段を別のジョブにする** — 秘密(API キー・Environment)を持つジョブで外の人の文章を扱う時間を減らす。
- **`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` をジョブの `env` に書く**(`allowed_non_write_users` を使わない) — `allowed_non_write_users` は書き込めない人にも起動を許す設定で、逆向き。scrub だけを入れる書き方は action の文書にある(ワークフローかジョブの `env`)。
- **bubblewrap が入らなければ動かさない** — 入らないと、Bash から Claude Code の本体の `/proc/<pid>/environ` を読めて、消した鍵が見える。手順の中で AppArmor の利用者の名前空間の制限を外すのは、使い捨ての Actions の機械だけ(action と同じ)。
- **GitHub のトークンは消さない** — `gh pr create` などとブランチへの送り出しに要る。トークンはジョブの間だけ使え(アプリのトークンは action が最後に取り消す)、権限は `permissions` まで。main はルールセットが守る。
- **外へ書く文章の検査をフックにする**(背景の AI だけでなく手元も) — 手元でも外へ秘密を書く理由は無い。手元で `KIT_EDIT_GUARD=pr` でも外さない。
- **gitleaks は「その間に書かれた全部」を見る**(AI の書いた物だけに絞らない) — 誰が書いたかで絞ると、AI がほかの名前で書いた物を見逃す。量は小さい。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
| 2026-10-27 | action のソースを読み、scrub が `allowed_non_write_users` のときしか自動で入らず、bubblewrap も入らないと分かった | 設計 | ジョブの `env` で scrub を入れ、bubblewrap を自分で入れる(1・5・11) | `claude.yml` |
