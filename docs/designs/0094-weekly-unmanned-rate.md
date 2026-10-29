# 設計: 無人化率を週ごとに1つの数で出す(pnpm metrics に1列)

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0098-weekly-unmanned-rate.md](../specs/0098-weekly-unmanned-rate.md)・週の数字の設計 [0035](0035-delivery-metrics.md)
> 状態: 完了
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

`pnpm metrics` が読むマージした PR に、コメントの数とレビューを足して読み、PR ごとに人の時間の幅と「全部を人が書いたら」の分を出す(費用のページと同じ式)。週ごとに足して無人化率にし、決裁用の表の1列と、その下の内訳の表に出す。

## 作業の前に読んだ物(ガイド)

- [../kit/roi.md](../kit/roi.md) の 2(式と、キット自身の数え: 149本・43〜68時間・78〜86%)と 4(`pnpm kpi --roi` の北極星の分母は同じ式)
- `scripts/cost/source-people.mjs` の `prMinutes`(PR 1件の人ごとの分。費用のページ)・`scripts/roi-lib.mjs` の `prFactOf`(幅の上の端 = 問い × 5分)
- `scripts/metrics/`(週の数字。`prFacts` は名前を持たない・週は日本時間の月曜)・`scripts/checkup/phase.mjs` の `mondayOf`・`todayInTokyo`(G-122 の日付の計算)

## 1. 設計方針

- **式は1か所**。`source-people.mjs` に `prMinuteRange`(low・high・byHand)を置き、週の数字と `pnpm kpi --roi` の両方が使う(`roi-lib.mjs` の手書きの 5分を移した)。
- **分の見分けは費用のページと同じ**(ラベル `ai:assisted` か本文の印)。今の「AI が手伝った」の列(ラベルだけ)は変えない。PR の事実に `aiAny` を別に持つ。
- **日付は phase.mjs の物を使う**。`weekOf`・`fullWeeks` を `mondayOf`・`todayInTokyo`・`addDays` で書き直し、metrics の中の時差の手計算を消した(数え方は同じ。テストはそのまま通る)。
- 新しい依存は無い(`yaml` は前から入っている。`metrics.yml` は `pnpm install` をする)。

## 2. データモデル

- 集める PR(`collect.mjs` の `toPr`): `comments`(コメントの数。ボットのコメントは除く。roi.md の 2 の数え直しと同じ)・`reviewers`(`{ login, type }` の並び)を足した。GraphQL に `comments(first: 100) { nodes { author { __typename } } }`・`reviews(first: 50) { nodes { author { login __typename } } }`。
- PR の事実(`prFacts`): `aiAny`・`comments`・`minutes { low, high, byHand }`(分)を足した。名前は持たない(改善用の PR の明細からは `minutes` も外す)。
- 週の行(`decision.weeks[]`): `unmanned`。合計は `decision.unmanned`(式の分 `rule` つき)。
  - `unmanned = { prs: { ai, human, bot }, questions, comments, humanCommits, hours: { low, high }, byHandHours, pct: { low, high } | null }`

## 3. API

- 該当なし(アプリの API は変えない)。`pnpm metrics` の引数も変えない。

## 4. 状態遷移

- 該当なし(状態を持たない)

## 5. システム間連携

- GitHub の GraphQL(読むだけ。今までの検索の問い合わせに2つの欄を足した)。権限は今までと同じ `pull-requests: read`。

## 6. 業務ルール

- PR 1件(`prMinuteRange`。分は `people.yaml` の `minutes`):
  - low: ボットの PR は `bot_pr_check`(5)。それ以外は AI の PR なら `ai_pr_check`(15)、人の PR なら `human_pr`(120)+ コメント × `comment`(3)+ 作った人以外・ボット以外のレビュー × `review`(20)
  - high: low + 問い × `question`(書かなければ 5)
  - byHand: AI の PR(ボットでない)は low − 15 + 120。それ以外は low
- 週: 無人化率の幅 = 低い方 `1 − Σhigh ÷ ΣbyHand`、高い方 `1 − Σlow ÷ ΣbyHand`(% に丸め、0〜100 で止める)。ΣbyHand が 0 なら —。分母に問いの分は足さない(roi.md と同じ)。
- 人の手直しは式に入れない(数だけ並べる)。
- 合計の行は、表の週(数え終わった週)の PR だけを足す。今週の PR は入れない。

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 決裁用の表に週ごとの「無人化率【推定】」の列が出る | 2. 週の行・`render.mjs` | `scripts/metrics/metrics.test.mjs` |
| 内訳の表(工数【推定】・PR・問い・コメント・手直し【実測】)と N 週の合計が出る | 2.・6. 合計の行 | `scripts/metrics/unmanned.test.mjs` |
| キット自身の数えを入れると 78〜86% になる | 6. 式 | `scripts/metrics/unmanned.test.mjs` |
| 式の分を `people.yaml` から読み、表の下に出す | 1.・6. | `scripts/metrics/unmanned.test.mjs`・`scripts/metrics/collect.test.mjs` |
| `pnpm kpi --roi` の分は変わらない(同じ式を使う) | 1. | `scripts/roi.test.mjs` |

## 8. 非機能

- 性能: GraphQL の1頁(50件)ごとに、レビュー最大 50 件が増えるだけ。読む PR の上限(1000)は変えない。
- セキュリティ: レビューした人の名前は分を数えるのにだけ使い、事実・JSON・Markdown に残さない(テストで確かめる)。
- 運用: `metrics.yml` は変えない(同じコマンドの出力が増えるだけ)。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離 | 該当なし(アプリを触らない) |
| 権限の表 | 該当なし |
| 監査ログ | 該当なし |
| 解約で消す一覧 | 該当なし |
| サポートの代理ログイン | 該当なし |
| ログの個人情報 | 該当なし(要約に人の名前を出さない。今までどおり) |
| 列の分類(`personal` / `sensitive`) | 該当なし |
| 画面の部品 | 該当なし |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 採用 | 式を1か所に寄せ、週の数字と北極星の分母が同じ物を使う |
| データモデル | 軽く確認 | PR の事実に3つ足しただけ |
| API | 低優先 | アプリの API は変えない |
| 状態遷移 | 低優先 | 状態を持たない |
| システム間連携 | 軽く確認 | GraphQL の欄を2つ足した |
| 業務ルール | 最重要 | roi.md の 2 と同じ式か(キット自身の数えで 78〜86% になるテスト) |
| 要求との対応 | 機械で検証 | `pnpm design-tests` |
| 非機能 | 軽く確認 | 名前を残さない |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- 無人化率だけ、AI の PR を「ラベルか本文の印」で見分ける — roi.md の 2 と費用のページがこの見分け方で、ラベルだけだと途中からラベルを付けたリポジトリで低く出る(キット自身の 2026-10-19 の週は「AI が手伝った 36%」)
- 幅は roi.md と同じく、分母に問いの分を足さない — 手で数えた値と突き合わせるため
- 低い方の端は 0% で止める — 問いが多い週に、負の割合を出さない(上の端はそのまま)
- コメントはボット(Actions の要約など)を除く — roi.md の 2 の数え直し(2026-10-29 の夕方)と同じ。AI が持ち主のアカウントで残した記録は見分けられないので数に入る(コメント 1件 3分なので、無人化率は1点ほど低めに出る側)
- 手直しは式に入れない — roi.md の 2 の式に入っていない。数だけ並べ、注に「多い週は高めに読んでいる」と書く
- `weekOf`・`fullWeeks` を phase.mjs の計算で書き直した — 日付の計算をリポジトリで1つにする(G-122)。数え方は同じ

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

- なし(作るかどうかは持ち主が会話で決めた: @attumkwg 2026-10-29「作る(pnpm metrics に1列)」)

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
