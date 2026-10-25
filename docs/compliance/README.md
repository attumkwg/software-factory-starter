# 認証の準備(P マーク・ISMS)

> 認証を取ると決めたときに使う置き場。取る予定が無ければ、ここは読まなくてよい(`/tailor` の「認証の予定」で消せる)。
> キットは**準備の道具**。認証を取るかの判断・審査機関とのやりとり・規程の中身の最終の確かめは、人と専門家がやる。
> 決まりは [設計書 0019](../designs/0019-evidence-soa-and-cost.md)・置き場の判断は [ADR 0032](../adr/0032-evidence-and-cost-outside-the-repo.md)。

## 1. 何があるか

| 物 | 何か | 作り方・確かめ方 |
|---|---|---|
| [controls.yaml](controls.yaml) | 附属書 A(ISO/IEC 27001:2022)の93の管理策の「適用する・しない・理由・このキットでの実施・根拠」。ここが正 | 人が直す(導入時に自社の範囲へ) |
| [soa.md](soa.md) | 適用宣言書(SoA)。管理策ごとに、当たる点検の項目・毎月の証跡・規程が並ぶ | `pnpm compliance --write` で作る(手で直さない) |
| [policies/](policies/README.md) | 規程と様式のひな形(基本方針・個人情報保護・委託先・教育・内部監査・マネジメントレビュー) | 「要記入」を埋めて承認する |
| [records/](records/README.md) | 教育・内部監査・マネジメントレビューの記録の置き場(の置き場) | 1回ごとに1枚 |
| 点検の台帳の `controls`・`evidence`・`area: compliance` | 点検の項目と管理策・証跡の対応。認証の準備の項目(規程の見直し・教育・内部監査など) | `/compliance-check` で1問ずつ |
| `evidence.yml` | 毎月1日に、GitHub と AWS の設定・訓練と点検の結果を、消せない S3 に置く | `pnpm evidence --list` で集める物の一覧 |

CI の `pnpm compliance` が、管理策の一覧の書き方・根拠のファイルの実在・台帳と規程が指す管理策と証跡の実在・この中の相対リンク・SoA の古さを見る(どれかで落ちる)。

## 2. 証跡の収集を始める(一度だけ。人がやる)

1. prod の Terraform を apply する(人が CI で。`module.evidence` と役割 `…-evidence` が足される)。**Object Lock の向き(GOVERNANCE / COMPLIANCE)と年数は、作った後に縮められない**ので、先に変数 `evidence_lock_mode`・`evidence_retention_years` を決める(設計書 0019 の U-1)。
2. 出力 `evidence_bucket` と `github_role_arns` の `…-evidence` を、リポジトリの変数 `EVIDENCE_BUCKET`・`AWS_EVIDENCE_ROLE_ARN` に入れる(Settings → Secrets and variables → Actions → Variables)。
3. Actions → Evidence → Run workflow(main で)を一度流す。Summary に置いたファイルの数が出る。読めなかった物があれば、ログの ⚠️ の行に理由が出る(権限・サービスが有効でない)。
4. 以後は毎月1日に流れる(キットから作ったリポジトリだけ)。点検の `evidence-monthly` が、35日のうちに成功したかを見る。

集める物(名前は台帳と SoA が指す。変えない):

| 名前 | 中身 |
|---|---|
| `github-ruleset` | main のルールセット(PR 必須・必須のチェック・例外) |
| `github-environments` | Environments(使えるブランチ・承認する人) |
| `github-collaborators` | 共同作業者と権限・招待中の人 |
| `github-actions` | Actions の設定 |
| `github-security` | 守りの機能と、開いている通知の**件数**(中身は入れない) |
| `drills` | 訓練と点検の実行の結果(戻す訓練・ファズ・ZAP・契約テスト・点検・脆弱性の検査・証跡の収集) |
| `aws-iam-summary`・`aws-iam-users`・`aws-iam-roles` | IAM の要約・人ごとの二段階認証と鍵の古さ(鍵の値は入らない)・役割の一覧 |
| `aws-securityhub` | Security Hub の点数と、落ちた管理策の番号 |
| `aws-guardduty`・`aws-backup`・`aws-cloudtrail` | 見張り・バックアップの保管庫のロック・記録が有効か |
| `checkup-ledger`・`compliance-docs` | 点検の台帳の状態・規程の版と SoA の SHA-256 |

置き方: `s3://<EVIDENCE_BUCKET>/evidence/<年>/<年-月>/<名前>.json` と `manifest.json`(各ファイルの SHA-256)。同じ月に流し直すと新しい版が足され、前の版も消えずに残る。

## 3. 自社の範囲に合わせる(導入時。人が決める)

1. 範囲を決める: どのサービス・どの人・事務所を持つか。`controls.yaml` の頭の `scope` に書く。
2. 管理策の適用・除外を見直す: キットの既定は「事務所の設備を持たない(A.7 の多くを除外)」「社員の閲覧を絞る道具を入れない(A.8.23 を除外)」。事務所を持つなら A.7.1〜A.7.6 などを適用にし、`how` を書く。
3. 規程の「要記入」を埋め、承認した日を `established` に書く。
4. `pnpm compliance --write` で SoA を作り直し、PR にする。
5. 認証を目指すと決めたら、点検の台帳の `compliance` を `true` にする(認証の準備の項目が毎週の点検にも出る)。

点検の `policies-adopt` が、制定日と「要記入」の埋め残しを確かめる。

## 4. 回し方(1年)

| いつ | 何を | 点検の項目 |
|---|---|---|
| 毎月1日 | 証跡が自動で集まる | `evidence-monthly` |
| 入るとき・年1回 | 教育と記録 | `training` |
| 年1回 | 委託先の見直し | `vendor-review` |
| 年1回(審査の前) | 内部監査 → マネジメントレビュー | `internal-audit` → `management-review` |
| 年1回(規程の `next_review`) | 規程と SoA の見直し | `policy-review` |
| 毎週(これまでどおり) | 守りの確かめ・権限の棚卸し・訓練など | 管理策ごとの対応は [soa.md](soa.md) |

期限の来た物は、Claude Code で `/compliance-check` と打つと1問ずつ聞かれ、答えが点検の台帳に書かれて PR になる(書き方は `/checkup` と同じ)。

## 5. 審査で見せる

- 適用宣言書: [soa.md](soa.md)(規程・点検の項目・証跡の名前が並ぶ)。
- その月の設定: S3 の `evidence/<年>/<年-月>/` を落とし、`manifest.json` の SHA-256 と中身が合うことを見せる(`sha256sum`)。Object Lock の保存の期間は、S3 のコンソールのオブジェクトの「オブジェクトロック」で見える。
- 回している記録: 点検の台帳の `history`(いつ・誰が・何を。足すだけで、CI が書き換えを止める)と、その PR。
- 教育・内部監査・マネジメントレビュー: 非公開の置き場の記録([records/](records/README.md))。

## 6. P マークと ISMS

| | P マーク | ISMS |
|---|---|---|
| 規格 | JIS Q 15001(個人情報) | ISO/IEC 27001(情報セキュリティ全体) |
| 適用宣言書 | 無い(個人情報の台帳とリスクの分析が中心) | 要る(このフォルダの soa.md) |
| ここで使う物 | 規程(特に個人情報保護規程)・教育・内部監査・代表者の見直し・委託先の管理・個人データの台帳([../db/personal-data.md](../db/personal-data.md)) | 全部 |

どちらも、規程を作ってから数か月、回した記録(教育・内部監査・見直し)があってから審査に申し込むのがふつう。
