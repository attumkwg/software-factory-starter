# GitHub を一括で整える(pnpm setup:github)

> キットから自分のリポジトリを作ったら、**最初に**これを流す。ブランチ保護・ラベル・Environments・Actions の設定を、1つのコマンドでそろえる。
> 設定の正はリポジトリのファイル(`.github/setup.yml`・`.github/labels.yml`)。GitHub の画面で直した値は、次に流したときに差分として出る。
> 考え方: [ADR 0027](../adr/0027-setup-before-use-and-kit-role.md)・決まりの全部: [designs/0014](../designs/0014-setup-before-use.md)

## 流し方

要るもの: `gh`(GitHub の CLI)で、そのリポジトリの**管理者**としてログインしていること(`gh auth status`)。

```bash
pnpm setup:github
```

まず試し。今の設定と、あるべき設定の**差分だけ**が出る(何も書き換えない)。中身を読んで、よければ:

```bash
pnpm setup:github --apply
```

差分のある所だけを書き、読み直して残りを出す。**何度流しても同じ結果**になる(そろっていれば差分は 0件)。

| 出てくる印 | 意味 |
|---|---|
| ✅ | そろっている |
| ➕ / ✏️ / ➖ | 足す / 直す / 外す(`--apply` で反映する) |
| ℹ️ | 一覧に無い物(消さない。表示だけ) |
| ⏭ | 飛ばす(非公開のリポジトリでは有料の物など) |
| ⚠️ | 読めなかった(権限が無い・プランで使えない)。ほかは続く |
| - [ ] | 人がやること(秘密の値・Renovate の App・`/kickoff` など) |

## 何をそろえるか

| 区分 | 中身 | 置き場所 |
|---|---|---|
| ラベル | 危険度(`risk:*`)・場所(`area:*`)・Issue の種類・依存の更新・点検の知らせ・訓練の記録・VRT の撮り直し。**意味と付いたらどうするかは [labels.md](labels.md)** | `.github/labels.yml`(手引きは `pnpm setup:labels` で作る) |
| リポジトリ | マージは Squash と Rebase だけ・自動マージを使える・マージしたらブランチを消す・「Update branch」のボタン | `.github/setup.yml` の `repository` |
| 守りの機能 | 秘密の見つけと push の保護・非公開の脆弱性の報告(公開のときだけ)・Dependabot の通知(直す PR は Renovate) | `security` |
| Actions | 既定は読むだけ・Actions が PR を承認できない・SHA で固定した Action だけ・外の人の PR は毎回承認・成果物とログは7日 | `actions` |
| ルールセット | main に PR 必須・必須のチェック・最新に追いついてから・直線の履歴・消せない・強制 push できない・例外なし | `ruleset` |
| Environments | stg・prod・claude・zap は main からだけ。prod は承認する人(既定は流した人) | `environments` |
| 変数 `KIT_ROLE` | ひな形なら `template`、キットから作ったリポジトリなら `product`(下の「ひな形と使う側」) | 名前で決まる(`template_repository`) |
| 秘密 | **名前だけ**確かめる。値は入れない。足りなければ「人がやること」に出る | `environments[].secrets`・`secrets` |

消さない物: 一覧に無いラベル(GitHub の既定の `bug` など。付いている Issue から外れてしまう)・ルールセットの中の、設定ファイルが扱わない規則(人が足したコードの検査など)・ほかのルールセット。

## ひな形と使う側(KIT_ROLE)

キットのリポジトリ(ひな形)は「作る物」で、運用はしない。運用(毎週の点検の Issue など)は、キットから作ったリポジトリで始める。例外は毎週の定期の脆弱性チェック(`vuln-scan.yml`): キットの依存と Action の新しい穴を見るので、ひな形でも回す(`.github/setup.yml` の `template_schedules`)。

| | ひな形(`template`) | 使う側(`product`) | セットアップの前(変数なし) |
|---|---|---|---|
| 定期で動くワークフロー(`schedule:`) | 飛ばす(`template_schedules` の `vuln-scan.yml` だけ動く) | 動く | 飛ばす(同じ) |
| 手で流す(Run workflow) | できる | できる | できる |
| CI・ラベル・ルールセット・Environments | 同じ | 同じ | — |

- セットアップの前に定期の運用が動かないのは、台帳の担当者がキットの持ち主のまま、点検の Issue が他人に向かないため。**セットアップを流さないと、点検の知らせは来ない**。
- 定期で動くワークフローを足すときは、`needs` の無いジョブ全部の `if` に `github.event_name != 'schedule' || vars.KIT_ROLE == 'product'` を書く(無いと CI の `pnpm setup:check` が落ちる)。ひな形でも回したい物は `.github/setup.yml` の `template_schedules` に理由つきで足す。

## 人がやること(セットアップが出す)

使う側のリポジトリでは、済んでいない物だけが出る:

1. Renovate の GitHub App を入れる([manual-setup.md](manual-setup.md) の 1 の 4)
2. `/kickoff`(何を作るか)→ `/tailor`(部品を選ぶ・`pnpm decisions --adopt`)
3. `.github/CODEOWNERS` のキットの持ち主を、自分かチームにする
4. 点検の台帳を自分の物にする: `pnpm checkup:adopt --by @自分`(使い始めた日を今日に・担当者を自分に・全部の項目を「まだ」に。キットの持ち主の記録は消さず、`adopted` の1行を足す)
5. 最初の `/checkup-refresh`
6. 使うなら秘密の値(Environment `claude` の `ANTHROPIC_API_KEY`・`zap` の2つ・リポジトリの `CHECKUP_TOKEN`・`SLACK_WEBHOOK_URL`)を GitHub の画面で
7. 直したファイル(3〜5)を1つの PR に

## キットの古くなった所(作り始めるときに出る)

キットそのものは定期の運用を回さない(動かし続けるのはライブラリの更新と、毎週の定期の脆弱性チェックだけ)。その代わり、使う側で `pnpm setup:github` を流すと、「人がやること」に次が出る:

- このリポジトリを作った後にキットが更新されている(取り込みたい直しが無いか、キットのコミットの一覧を見る)
- キットの台帳が世の中の変化を取り込んだのが古い・一度も無い → 最初の `/checkup-refresh`
- 見直す日の過ぎた台帳の項目がある → `/checkup-refresh` で見直す
- Renovate を入れると、キットに溜まった依存の更新が PR で出る(最初の週は多め)

キットの持ち主が古くなった所を直したいときは、キットのリポジトリで `/checkup-refresh` を手で1回流して PR にする(定期では回さない)。

## ラベル・必須のチェックを足すとき

- **ラベル**を使う物(ワークフロー・Issue のテンプレート・スキルの `--label`・スクリプトの定数)を足したら、`.github/labels.yml` に1件足す(何のラベルか・誰が・いつ・付いたらどうするかも)。`pnpm setup:labels` で [labels.md](labels.md) を作り直す。無い・古いと CI の `pnpm setup:check` が落ちる。
- **ジョブの名前**を変えた・消したら、`.github/setup.yml` の `required_checks` も直す。必須のチェックの名前がジョブに無いと、全部の PR が「来ないチェック」を待って止まるので、CI が落とす。
- **新しい Environment** を使うワークフローを足したら、`environments` に足す。
- PR の本文に「マージの後に人がやる設定」は書かない。代わりに設定ファイルを直し、**マージの後に `pnpm setup:github --apply`** を流す(Actions には設定を書く権限を持たせない)。

## 👥 人が増えたら

`.github/setup.yml` の値を変えて流し直す:

- `ruleset.required_approvals: 1`・`require_code_owner_review: true`・危険度「高」を2人にするなら `ruleset.high_risk_approvals: 2`(必須のチェック「危険度「高」の承認の人数」が数える。ルールセットの承認数は全部の PR に同じ値がかかり、CODEOWNERS は並べた誰か1人で通るので、それだけでは「高だけ2人」にならない。仕様 0059)
- `environments` の prod の `reviewers` を2人以上・`prevent_self_review: true`

## うまくいかないとき

| 出たこと | 直し方 |
|---|---|
| `リポジトリ … を読めなかった(HTTP 404)` | 名前が違うか、管理者でない。`gh auth status`・`--repo owner/name` |
| ルールセットが `HTTP 403`(Upgrade) | 非公開+Free ではルールセットが効かない。公開にするか Pro / Team に([local-guards.md](local-guards.md)) |
| prod の承認する人が `HTTP 422` | 非公開のリポジトリでは、Pro / Team でも承認する人を置けない(公開か Enterprise だけ) |
| `pnpm setup:check` が「必須のチェック … がジョブに無い」 | ジョブの `name:` と `.github/setup.yml` の `required_checks` をそろえる |
| `pnpm setup:check` が「ラベル … が一覧に無い」 | `.github/labels.yml` に足す(名前・色・説明・何が使うか) |
