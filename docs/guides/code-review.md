# コードレビューを良くする選択肢

> **いまはどれも自動で動かしていません。** 自動にするものは、下の表の「自動にする日」に日付を入れてから。
> おすすめ: **PMF 前は A を手で回す。PR が増えて人のレビューが詰まってきたら、B か C を自動にする。**
> C(Anthropic 公式)は 2026年10月時点の公式の説明で確かめた範囲だけを書いています。

## 比べる

| 方法 | どう動かすか | 費用 | 向いている段階 | 自動にする日 |
|---|---|---|---|---|
| **A** 手元で回す | Claude Code で `/code-review <PR番号>`・`/security-review`・`/review-pr <PR番号>` | Claude Code の席の範囲(追加なし) | PMF 前から | ―(手で回す) |
| **B** `@claude`(claude.yml) | PR のコメントで `@claude` に頼む(GitHub Actions で動く) | Claude の API の従量+Actions の分数 | PR が週に数十件〜 | ここに日付を入れてください |
| **C** Anthropic 公式の Code Review | 組織の Owner が設定すると、PR ごとに Claude がレビューを書く | 使ったトークン分(使用量のクレジット)。月の上限を決められる | Team / Enterprise で PR が多い | ここに日付を入れてください |
| **D** 外部のサービス(CodeRabbit など) | GitHub App を入れると PR ごとにレビュー | 席の費用(要確認) | 5人以上で、自分たちで手入れしたくないとき | ここに日付を入れてください |

## A: 手元で回す(いまの形)

| コマンド | 何をする | 結果 |
|---|---|---|
| `/review-pr <番号>` | このキットのスキル。差分を判断の単位に分け、**人に判断してほしい所**(権限の表・移行・Terraform・認証認可・テナント分離)を冒頭に出し、危険度ごとのチェックをする | PR へのコメント案。投稿は OK のときだけ |
| `/code-review <番号>` | Claude Code の組み込み。正しさの不具合を探す。`--comment` で PR に行ごとのコメント | 見つけた物の一覧 |
| `/security-review` | ブランチの変更から、認可の漏れ・注入などを探す | 見つけた物の一覧 |

使い分け: まず `/review-pr` で「どこを見るべきか」をつかみ、危険度「高」なら `/security-review` も。細かい不具合探しは `/code-review`。
公式の説明: [ローカルでレビューする(/code-review)](https://code.claude.com/docs/en/code-review-local)。

## B: PR のコメントで `@claude`

- `.github/workflows/claude.yml`(いまは手動だけ)。自動にすると、PR のコメントに「`@claude` このPRをレビューして。`.claude/skills/review-pr` の手順で」と書くだけで動く。
- 起動できるのはリポジトリの持ち主(OWNER)だけ(他の人のコメントは読ませない)。PR では会話欄のコメント(`issue_comment`)で頼む。レビューの行ごとのコメントは、API キーを main だけの Environment に置いたので動かない(README の「本人がやる設定」)。
- 費用: Claude の API(使った分)+Actions の分数。PR の大きさで変わる。小さな PR で数十円〜数百円の目安。
- 有効にするやり方は [automation.md](automation.md)。

## C: Anthropic 公式の Code Review(GitHub)

公式の説明で確かめたこと(2026年10月時点):

- **リサーチプレビュー**。**Team と Enterprise** のプランで使える。Zero Data Retention の組織では使えない。
- 組織の Owner が `claude.ai` の **Admin settings > Claude Code** で有効にし、Claude の GitHub App を入れて、リポジトリを選ぶ。**リポジトリにワークフローのファイルは要らない**(Anthropic の側で動く)。
- Claude は行ごとのコメント・まとめ・「Claude Code Review」というチェックを書く。**承認も止めもしない**(チェックは失敗しない)。
- いつ動くかをリポジトリごとに選べる: PR を作ったとき1回 / push のたび / 手動(`@claude review` とコメントしたときだけ)。
- 深さを選べる: Quick / Standard / Deep(深いほど費用が上がる)。
- 費用: 1回いくらではなく、**使ったトークン分を使用量のクレジットから**。組織に請求され、**Code Review だけの月の上限**を決められる。
- 何を指摘させるかは、リポジトリの `REVIEW.md` と `CLAUDE.md` で調整できる。

始めるときのおすすめの設定:

1. 先に **月の上限**を決める([費用と上限](https://code.claude.com/docs/en/code-review-costs))。
2. いつ動くかは **「手動(`@claude review`)」か「作ったとき1回」** から。push のたびは件数が増える。
3. 何件か回して、管理の画面の「1回の平均の費用」を見てから広げる。
4. このキットの「人に判断してほしい所」を見てほしいので、`REVIEW.md` に `.claude/skills/review-pr/SKILL.md` の 4・5 の要点を書く。**要確認**: `REVIEW.md` の書き方の詳細は [Code Review を調整する](https://code.claude.com/docs/en/code-review-customize) を見てから。

⚠️ **B と C を両方有効にすると、どちらも `@claude` に反応しうる**。C を使うなら、B の `claude.yml` は「実装を頼む」用に絞る(コメントの言葉を分けるなど)。**要確認**: 両方を同じリポジトリで使うときの振る舞いは、公式の説明でまだ確かめていない。

公式の説明: [Code Review の概要](https://code.claude.com/docs/en/code-review)・[設定](https://code.claude.com/docs/en/code-review-setup)・[PR での読み方と頼み方](https://code.claude.com/docs/en/code-review-pull-requests)。

## D: 外部のサービス(CodeRabbit など)

- GitHub App を入れると、PR ごとにまとめと行ごとのコメントが付く。設定ファイルで何を見るかを決められる。
- 費用は**書く人1人あたりの月額**(席)。**要確認**: 最新の料金は各サービスの料金表で(このキットの調べでは 月 $20〜30 前後の目安)。
- 向いている所: 自前のレビューの仕組みを手入れしたくない・人数が増えた(freee は自前の AI レビューをやめて CodeRabbit にした)。
- 気をつける所: コードを外のサービスに渡すことになる(契約・データの扱いを確かめる)。

## どれを使っても変わらないこと

- **AI のレビューは一次レビュー**。危険度「中」は1人、「高」は2人の人のレビューが要る(CODEOWNERS とブランチ保護)。
- **AI に承認させない**。承認するのは人。
- 同じ指摘が2回出たら、ルール(Semgrep・lint)かテストかスキルにして、次から機械で止める([playbook.md](../playbook.md) の毎週の振り返り)。
