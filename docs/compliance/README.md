# 認証の準備(P マーク・ISMS・SOC 2)の入口

> 認証で求められる「誰に・何を預け、どう守り、何が残っているか」を、ここから辿る。**正はコードとこのフォルダのファイル**で、審査に出す一覧はそこから作る(手で写さない)。
> 法令と認証の当てはめは「分かる範囲で」。取ると決めたら、専門家(審査機関・弁護士・コンサルタント)と確かめる。部品を残すかは `/tailor`(カタログの `certification-prep`)。
> キットは**準備の道具**。認証を取るかの判断・審査機関とのやりとり・規程の中身の最終の確かめは、人と専門家がやる。証跡と SoA の決まりは [設計書 0019](../designs/0019-evidence-soa-and-cost.md)・置き場の判断は [ADR 0032](../adr/0032-evidence-and-cost-outside-the-repo.md)。

## 1. 中身

| 物 | 何か | 正 | 確かめ方 |
|---|---|---|---|
| [委託先の台帳](vendors.yaml)(人が読む一覧: [vendors.md](vendors.md)) | 外の会社ごとに、預け方・国・渡す区分・契約(DPA)・第三者の認証・消え方 | `vendors.yaml` | `pnpm vendors`(CI。コードの SDK・Terraform の AWS のサービス・Actions が台帳にあるか) |
| [AI に渡すデータの決まり](ai-data.md) | 本番の個人データは渡さない(ID と集計まで)・要配慮は一切。出どころごとの表と、渡してしまったとき | `docs/security.md` の AI-6 | 台帳の AI の会社に personal・sensitive が無いか(`pnpm vendors`) |
| 管理操作の記録(CloudTrail) | AWS の操作を、ロックした S3 に400日(消す・方針を変えると鳴る) | `infra/terraform/modules/audit-trail` | 手順書 [runbooks/audit-trail.md](../runbooks/audit-trail.md)(入れ方・調べ方・書き換えの検証) |
| [controls.yaml](controls.yaml) | 附属書 A(ISO/IEC 27001:2022)の93の管理策の「適用する・しない・理由・このキットでの実施・根拠」 | `controls.yaml`(人が直す。導入時に自社の範囲へ) | `pnpm compliance`(CI) |
| [soa.md](soa.md) | 適用宣言書(SoA)。管理策ごとに、当たる点検の項目・毎月の証跡・規程が並ぶ | `controls.yaml`・点検の台帳・規程から `pnpm compliance --write` で作る(手で直さない) | `pnpm compliance`(古いと落ちる) |
| [policies/](policies/README.md) | 規程と様式のひな形(基本方針・個人情報保護・委託先・教育・内部監査・マネジメントレビュー) | 各ファイル(「要記入」を埋めて承認する) | `pnpm compliance`・点検の `policies-adopt`・`policy-review` |
| [scs.md](scs.md) | 国のサプライチェーンの評価制度(SCS 評価制度・★3・★4)の要求事項43件と、管理策・キットの仕組み・使う人がやることの対応表(準備の表。評価の結果ではない) | `scs.md`(公的な一次資料で確かめた日つき) | 点検の `scs-review`(半年ごと) |
| [records/](records/README.md) | 教育・内部監査・マネジメントレビューの記録の置き場(の置き場) | 非公開の置き場 | 点検の `training`・`internal-audit`・`management-review` |
| 点検の台帳の `controls`・`evidence`・`area: compliance` | 点検の項目と管理策・証跡の対応。認証の準備の項目 | [checkup/todo.yaml](../checkup/todo.yaml) | `/compliance-check` で1問ずつ |
| 毎月の証跡(`evidence.yml`) | 毎月1日に、GitHub と AWS の設定・訓練と点検の結果を、消せない S3 に置く | 使う側の AWS の S3 | 点検の `evidence-monthly`・`pnpm evidence --list` |

足すときは、この表に1行(何か・正・確かめ方)。CI の `pnpm compliance` は、管理策の一覧の書き方・根拠のファイルの実在・台帳と規程が指す管理策と証跡の実在・このフォルダの相対リンク・SoA の古さを見る(どれかで落ちる)。

## 2. ほかの場所にある物(認証で聞かれる順)

| 聞かれること | どこ |
|---|---|
| どんな個人情報を・何のために持つか | 列の分類表 `apps/api/src/db/classification.ts` → 台帳 [db/personal-data.md](../db/personal-data.md)(生成) |
| 要配慮の分け方 | [ADR 0018](../adr/0018-sensitive-data-isolation.md) |
| ログに個人情報を出さない | [ADR 0019](../adr/0019-log-allowlist.md)(許可リスト)・`docs/security.md` の「毎回の検査」 |
| アプリの中の「誰が何をしたか」 | 監査ログ [ADR 0013](../adr/0013-audit-log.md) |
| 権限(誰が何をできるか)と、その確かめ方 | [authz/matrix.yaml](../authz/matrix.yaml)・`docs/security.md` の 決まり 2 |
| バックアップと戻す訓練 | [ADR 0012](../adr/0012-backup-vault-and-restore-drills.md)・[runbooks/db-restore.md](../runbooks/db-restore.md) |
| 事故のとき(漏えいの報告・本人への通知) | [runbooks/incident.md](../runbooks/incident.md)・[runbooks/personal-data-breach.md](../runbooks/personal-data-breach.md) |
| 解約したお客さんのデータを消す | [runbooks/offboarding.md](../runbooks/offboarding.md)・台帳の `when_tenant_leaves` |
| 脆弱性の管理 | [guides/vulnerabilities.md](../guides/vulnerabilities.md)・[security/vulns.md](../security/vulns.md) |
| 定期の点検(アクセスの見直しなど) | 点検の台帳 [checkup/todo.yaml](../checkup/todo.yaml) |
| 利用規約・プライバシーポリシーと同意 | [guides/legal-documents.md](../guides/legal-documents.md) |
| 管理策ごとの「やる・やらない・どうやって」 | 適用宣言書 [soa.md](soa.md) |

## 3. 使い始めたらやること

1. **委託先の台帳を自分の契約に書き直す**: `vendors.yaml` の `contract.dpa`(結んだ日・プラン)・`country`(Sentry などは置き場所を選んだか)・`checked_on`。使わない会社は `status: ended`。直したら `pnpm vendors --write`。
2. **越境の扱いを専門家に確かめる**: 米国の委託先(AI・Sentry・GitHub・Slack)に ID を渡すことを、プライバシーポリシーにどう書くか(設計書 0017 の U-1)。
3. **管理操作の記録の保存の日数とロックの強さを決めてから、prod に apply**(手順書 audit-trail.md の 2。既定は governance。誰にも消せなくするなら compliance)。
4. **範囲を決める**: どのサービス・どの人・事務所を持つか。`controls.yaml` の頭の `scope` に書く。キットの既定は「事務所の設備を持たない(A.7 の多くを除外)」「社員の閲覧を絞る道具を入れない(A.8.23 を除外)」。事務所を持つなら A.7.1〜A.7.6 などを適用にし、`how` を書く(設計書 0019 の U-3。導入時に決める)。
5. **規程の「要記入」を埋め**、承認した日を `established` に書く。`pnpm compliance --write` で SoA を作り直し、PR にする。点検の `policies-adopt` が、制定日と埋め残しを確かめる。
6. **認証を目指すと決めたら**、点検の台帳の `compliance` を `true` にする(認証の準備の項目が毎週の点検にも出る。設計書 0019 の U-2。導入時に決める)。
7. 年に1回、委託先の台帳を見直す(会社の認証・約款・置き場所が変わっていないか)。`checked_on` を直す(点検の `vendor-review`)。

## 4. 証跡の収集を始める(一度だけ。人がやる)

1. **Object Lock の向きと年数を決めてから** prod の Terraform を apply する(人が CI で。`module.evidence` と役割 `…-evidence` が足される)。既定は GOVERNANCE・3年(変数 `evidence_lock_mode`・`evidence_retention_years`。設計書 0019 の U-1。導入時に決める)。**作った後に縮められない**(COMPLIANCE にすると、期間の間は root でも消せない)。
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

置き方: `s3://<EVIDENCE_BUCKET>/evidence/<年>/<年-月>/<名前>.json` と `manifest.json`(各ファイルの SHA-256)。同じ月に流し直すと新しい版が足され、前の版も消えずに残る。管理操作の記録(CloudTrail)の置き場とは別。

## 5. 回し方(1年)

| いつ | 何を | 点検の項目 |
|---|---|---|
| 毎月1日 | 証跡が自動で集まる | `evidence-monthly` |
| 入るとき・年1回 | 教育と記録 | `training` |
| 年1回 | 委託先の見直し(`vendors.yaml`) | `vendor-review` |
| 年1回(審査の前) | 内部監査 → マネジメントレビュー | `internal-audit` → `management-review` |
| 年1回(規程の `next_review`) | 規程と SoA の見直し | `policy-review` |
| 毎週(これまでどおり) | 守りの確かめ・権限の棚卸し・訓練など | 管理策ごとの対応は [soa.md](soa.md) |

期限の来た物は、Claude Code で `/compliance-check` と打つと1問ずつ聞かれ、答えが点検の台帳に書かれて PR になる(書き方は `/checkup` と同じ)。

## 6. 審査で見せる

- 適用宣言書: [soa.md](soa.md)(規程・点検の項目・証跡の名前が並ぶ)。
- その月の設定: S3 の `evidence/<年>/<年-月>/` を落とし、`manifest.json` の SHA-256 と中身が合うことを見せる(`sha256sum`)。Object Lock の保存の期間は、S3 のコンソールのオブジェクトの「オブジェクトロック」で見える。
- 回している記録: 点検の台帳の `history`(いつ・誰が・何を。足すだけで、CI が書き換えを止める)と、その PR。
- 委託先: [vendors.md](vendors.md)(台帳から作る)。
- 教育・内部監査・マネジメントレビュー: 非公開の置き場の記録([records/](records/README.md))。

## 7. P マークと ISMS

| | P マーク | ISMS |
|---|---|---|
| 規格 | JIS Q 15001(個人情報) | ISO/IEC 27001(情報セキュリティ全体) |
| 適用宣言書 | 無い(個人情報の台帳とリスクの分析が中心) | 要る(このフォルダの soa.md) |
| ここで使う物 | 規程(特に個人情報保護規程)・教育・内部監査・代表者の見直し・委託先の台帳と管理・個人データの台帳([../db/personal-data.md](../db/personal-data.md)) | 全部 |

どちらも、規程を作ってから数か月、回した記録(教育・内部監査・見直し)があってから審査に申し込むのがふつう。
