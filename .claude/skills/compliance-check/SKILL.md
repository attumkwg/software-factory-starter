---
name: compliance-check
description: 認証(P マーク・ISMS)の準備の点検。点検の台帳(docs/checkup/todo.yaml)の area: compliance の項目(規程を自社の物にする・期限の来た規程と適用宣言書の見直し・教育・委託先の見直し・内部監査・マネジメントレビュー・毎月の証跡)だけを1問ずつ聞き、答えを pnpm checkup:answer で台帳に書いて1つの PR にする。/checkup の一種。「認証の準備」「P マーク」「ISMS」「規程の見直し」「教育の記録」「内部監査」「マネジメントレビュー」「/compliance-check」と言われたとき、点検で認証の準備の項目が出たときに使う。
---

# 認証の準備を、1問ずつ確かめる

目的: 認証(P マーク・ISMS)を目指す担当者が、**期限の来た「回している記録」を、選ぶだけで残していける**ようにする。中身の決まりは `docs/compliance/README.md`(先に読む)と `docs/designs/0019-evidence-soa-and-cost.md` の 6.。

**聞き方・書き方・PR の出し方は `/checkup` と同じ**(`.claude/skills/checkup/SKILL.md` を読み、その「進め方の決まり」「聞き方」「まとめて確認する」「OK をもらってからすること」に従う)。ここには違う所だけを書く。

## 違う所

- 項目は `pnpm checkup --area compliance --json` で出す(台帳の `compliance` が false でも出る。Issue は書かない)。
- ブランチの名前は `compliance/answers-YYYYMMDD`、コミットは `認証の準備の答え YYYY-MM-DD: N 件`。PR の取り組みは「保守」・作業の種類は「保守」。
- 記録の中身(教育を受けた人・監査の指摘・議事録)は**台帳にも PR にも書かない**(人の名前が入る)。台帳の `--note` には「どこに置いたか」だけを書く(例: `--note "記録は社内の文書の 2027 教育"`)。置き場は `docs/compliance/records/README.md` の表。
- 規程の本文を直すのは、答えの PR とは別(「次にやること」に並べ、OK をもらってから別の PR)。ただし `policies-adopt`・`policy-review` で担当者が「この場で直す」と言ったら、同じ PR で規程の頭の日付(`established`・`last_reviewed`・`next_review`)と `version`・改訂の記録を直し、`pnpm compliance --write` で適用宣言書を作り直してよい。
- 規程の「要記入」の中身(会社名・責任者・窓口)は、担当者が答えた言葉だけを入れる。推測で埋めない。

## まず確かめる(聞く前に)

1. `pnpm checkup --area compliance --json` と `pnpm compliance` を流す。後者が落ちたら、何が落ちたか(リンク切れ・SoA が古い)を伝え、直す PR を先に出すか聞く。
2. 台帳の頭の `compliance` を見る。
   - **false** なら最初に1問だけ: 「認証(P マーク・ISMS)を目指しますか。目指すなら、認証の準備の項目を毎週の点検にも出します」(AskUserQuestion: 「目指す(毎週の点検にも出す)」「まだ決めていない(ここだけで見る)」「目指さない」)。
     - 目指す → 答えの PR で台帳の `compliance: false` を `true` に直す(この1行だけは手で直してよい。記録ではなく設定のため)。
     - 目指さない → 「認証の準備は `/tailor` で消せます(`certification-prep`)」と伝えて終わる(何も書かない)。
3. 担当者の確かめ(ログイン名と台帳の `owners`)は `/checkup` と同じ。

## 項目ごとの聞き方の足し

| 項目 | 足すこと |
|---|---|
| `policies-adopt` | `pnpm checkup --area compliance` の行に、まだひな形の規程の名前が出る。1つずつ、「要記入」の所を担当者に聞いて埋めるか、「後で自分で埋める」かを聞く。範囲(事務所の有無)は `docs/compliance/README.md` の 3. の問いで聞き、事務所を持つなら A.7.1〜A.7.6 を適用にする案を出す |
| `evidence-monthly` | 自動で確かめる。落ちていたら、`docs/compliance/README.md` の 2. のどこまで済んでいるか(apply・変数・一度流したか)を聞き、次の手順を出す。AWS の apply と変数の設定は人がやる |
| `training` | 年1回の教育を「やった」なら、記録の置き場を `--note` に。新しく入った人がいれば、その人の分も済んだかを聞く |
| `vendor-review` | 委託先の一覧の置き場を聞き、見直した日を書いたかを聞く。やめた委託先があれば、権限と連携を外したか |
| `internal-audit` | 不適合があったか・直す計画を書いたかを聞く(中身は書かない)。監査した人が、監査される所を作った人と別か |
| `management-review` | 内部監査の報告を出したか・「決めたこと」を書いたかを聞く |
| `policy-review` | `pnpm compliance` の結果と、見直しの日の来た規程の名前を出す。この1年の変化(事故・監査の指摘・法令・委託先)で直す所があるかを、規程ごとに聞く |

## してはいけない

- 審査機関・コンサルタントへの連絡、契約、申し込み(お金と契約。人がやる)。
- 規程を、担当者が答えていない中身で「制定済み」にする(`established` を勝手に入れない)。
- 証跡の置き場(S3)の中身を読み出して会話や PR に貼る。
