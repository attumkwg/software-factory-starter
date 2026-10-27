# 設計: 危険度「高」の PR だけ、人の承認を決めた人数そろえる

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0059-high-risk-approvals.md](../specs/0059-high-risk-approvals.md)
> 状態: 下書き
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

必須のチェック「危険度「高」の承認の人数」を足す。PR が「高」の場所を変えていたら、書き込める人の承認を数え、`.github/setup.yml` の `ruleset.high_risk_approvals` に届くまで落とす。数える中身は土台のブランチの物を使う。

## 作業の前に読んだ物(ガイド)

- `.github/setup.yml`(ルールセットの承認数は1つの値・`required_checks`)・`scripts/setup/config.mjs`(書き方の確かめ)・`scripts/setup/areas-ruleset.mjs`(`required_approving_review_count` に写す)
- `.claude/hooks/protected-paths.json`・`.claude/hooks/guard-edit.mjs`(当たり方: `x/**` は下の全部、ほかは同じ名前だけ)・`scripts/check-guards.mjs`(一覧・labeler・CODEOWNERS をそろえる)
- `.github/workflows/pr-work.yml`(PR だけで流れる軽いチェックの型・依存を入れない・本文は env で渡す)
- `docs/guides/local-guards.md`(GitHub のプランで変わる守り)・`docs/guides/github-setup.md`・`docs/guides/manual-setup.md`(人が増えたときの設定)
- 穴 G-43(`docs/scenarios/gaps.md`)・`docs/scenarios/09-adoption.md` の 9-4

## 1. 設計方針

- GitHub の機能(ルールセット・CODEOWNERS)では「パスごとの人数」を表せないので、**必須のチェックで数える**。GitHub Actions のワークフロー1つ(`high-risk-approvals.yml`)と、依存の無い Node のスクリプト(`scripts/review-count.mjs`・中身は `review-count-lib.mjs`)。
- 「高」かどうかは、ラベル(labeler が後から付ける)を待たずに、**変えたファイルを一覧に当てて自分で決める**。ラベル `risk:high`(Renovate が付ける物など)も「高」とみなす。
- **土台のブランチ(`pull_request.base.sha`)を checkout** して、その一覧・人数・スクリプトで数える。PR の中の変更は、その PR の判定に効かない。
- 人数の正は `.github/setup.yml` の `ruleset.high_risk_approvals`(既定 0)。`required_checks` にも足す。

## 2. データモデル

該当なし(DB を使わない)。

## 3. API

該当なし(アプリの API は変えない)。GitHub の REST を `gh api` で読むだけ: `pulls/{n}`(作った人・ラベル)・`pulls/{n}/files`(名前と元の名前)・`pulls/{n}/reviews`(人・状態・`author_association`)。ページは `--paginate --slurp` で全部。

## 4. 状態遷移

- レビューの状態は、人ごとに最後の物を使う。`COMMENTED`・`PENDING` は判断を変えない。`APPROVED` だけ数える(`CHANGES_REQUESTED`・`DISMISSED` は数えない)。
- 古い承認は、ルールセットの `dismiss_stale_reviews: true` で push のたびに `DISMISSED` になる。

## 5. システム間連携

- 起動: `pull_request`(opened・synchronize・reopened・labeled・unlabeled)と `pull_request_review`(submitted・edited・dismissed)。
- 権限: `contents: read`・`pull-requests: read`。`GITHUB_TOKEN` だけ。外への送信なし。
- 土台にまだスクリプトが無い(このチェックを足す PR・キットから作ったばかりで古い土台)ときは数えずに通す。

## 6. 業務ルール

- 数える人: `author_association` が OWNER・MEMBER・COLLABORATOR。PR を出した人・ボット(`user.type === "Bot"`)は数えない。
- 人数: 0 なら数えずに通す(1人の間)。1〜6。`required_approvals` より少なくはできない(`pnpm setup:check`)。
- 「高」の当たり方は guard-edit と同じ。名前を変えたファイルは元の名前も当てる。

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 「高」で人数に届くまで落ちる | 1・6 | `scripts/review-count.test.mjs`(判定) |
| 「高」でなければ通る | 6 | 同(判定) |
| 人数 0 は通る | 6 | 同(判定・人数の読み方) |
| 数えない承認 | 4・6 | 同(承認) |
| レビューで流れ直す | 5 | ワークフローの `on`(CI で確かめる) |
| PR の中で緩めても効かない | 1 | ワークフローの checkout(base.sha) |
| 人数の書き方の確かめ | 6 | `scripts/setup/check.test.mjs` |

## 8. 非機能

- 性能: API を3〜4回・5分で打ち切り。依存を入れないので数秒。
- セキュリティ: 仕様の STRIDE のとおり。式を run に直接書かない(番号とリポジトリの名前を env で渡す)。
- 運用: 落ちたら出力に「あと何人」と承認した人を出す。
- 費用: Actions の分数がわずかに増える(PR とレビューのたびに1分未満)。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離 | 該当なし |
| 権限の表 | 該当なし |
| 監査ログ | 該当なし(GitHub のレビューの記録が残る) |
| 解約で消す一覧 | 該当なし |
| サポートの代理ログイン | 該当なし |
| ログの個人情報 | GitHub のユーザー名だけを出力に出す |
| 列の分類(`personal` / `sensitive`) | 該当なし |
| 画面の部品 | 該当なし |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 最重要 | 「高」の約束を守る最後の関所。土台のブランチで数える所 |
| データモデル | 低優先 | 該当なし |
| API | 低優先 | GitHub を読むだけ |
| 状態遷移 | 採用 | レビューの最後の状態の扱い |
| システム間連携 | 採用 | 起動のきっかけと権限 |
| 業務ルール | 最重要 | 誰の承認を数えるか |
| 要求との対応 | 機械で検証 | 単体テスト |
| 非機能 | 軽く確認 | 読むだけ・短い |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- ラベルを待たずにファイルで決める — labeler と同時に動くので、ラベルが付く前に流れると「高」を見逃す。
- 土台のブランチの中身で数える — PR の中で一覧・人数・スクリプトを緩めて通すのを防ぐ。
- 書き込める人だけ数える — 公開のリポジトリでは誰でも「承認」のレビューを付けられる。
- 新しいワークフローにする(`ci.yml` に入れない) — レビューのたびに重い CI を流し直さない(`pr-work.yml` と同じ考え)。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|
| U-1 | 設計 | 戻せないリスク | キットの既定の人数は 0(数えない)。人が増えたら 2 にする | 1人の間は自分の PR を自分で承認できず、AI の PR も自分のアカウントで出るので、1 以上だと「高」の PR が全部止まる | 既定は 0 でよいか(使い始めた人が人数を決める「導入時に決める」にするか) | 承認(@attumkwg 2026-10-27。会話で回答「キットの既定は 0(1人の間は数えない)、人が増えたら 2」) |

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
| 2026-10-27 | 作りながら、公開のリポジトリでは外の人の「承認」も数えてしまうと気づいた | 設計 | 書き込める人だけ数える(6・11) | テスト(外の人・過去の貢献者の承認) |
