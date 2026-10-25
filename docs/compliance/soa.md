# 適用宣言書(SoA)

> この1枚は [controls.yaml](controls.yaml)(管理策の一覧。ここが正)・[点検の台帳](../checkup/todo.yaml)・[規程](policies/) から `pnpm compliance --write` で作る。手で直さない(古いと CI の `pnpm compliance` が落ちる)。
> 規格: ISO/IEC 27001:2022 附属書 A。管理策の名前は、このキットでの言い換え(正式な名前と中身は規格の本文で確かめる)。
> 適用 82件・除外 11件(全 93件)。範囲(キットの既定): このリポジトリで作る SaaS(API・画面・メールの中継)と、それを動かす AWS(stg・prod)と GitHub・開発に使う端末。事務所の設備は持たない前提
> 点検の項目 = [docs/checkup/README.md](../checkup/README.md) の id(毎週・毎月の確かめと答えの記録)。証跡 = `evidence.yml` が毎月、消せない置き場に集める物の名前(`pnpm evidence --list`)。使い方は [README.md](README.md)

## 組織の管理策(A.5)

| 番号 | 管理策 | 適用 | 理由 | このキットでの実施 | 点検の項目 | 証跡 | 規程・根拠 |
|---|---|---|---|---|---|---|---|
| A.5.1 | 情報セキュリティの方針 | 適用 | 方針は全ての管理策の土台 | 基本方針を経営者が承認し、全員に知らせ、年1回見直す(点検 policy-review) | `policies-adopt` `management-review` `policy-review` | `compliance-docs` | [basic-policy.md](policies/basic-policy.md) [management-review.md](policies/management-review.md) [security.md](../security.md) |
| A.5.2 | 役割と責任 | 適用 | 誰が何をするかを決めないと、事故のときに止まる | 基本方針に責任者を書き、点検の担当者と相談先を台帳に書く。人と AI の分担は考え方の本体に | `team-review` |  | [basic-policy.md](policies/basic-policy.md) [people-and-ai.md](../concepts/people-and-ai.md) [todo.yaml](../checkup/todo.yaml) |
| A.5.3 | 職務の分離 | 適用 | 1人で作って本番に出せると、誤りも不正も止まらない | main は PR と CI が必須・AI は承認もマージもできない・本番は Environment の承認のあと。人が増えたら2人の承認(.github/setup.yml) | `gh-protection` `gh-envs` `team-review` | `github-ruleset` `github-environments` | [setup.yml](../../.github/setup.yml) [local-guards.md](../guides/local-guards.md) |
| A.5.4 | 経営者の責任 | 適用 | 経営者が方針と資源を決めないと回らない | マネジメントレビューを年1回(議事録の型)。基本方針は経営者が承認する | `management-review` |  | [management-review.md](policies/management-review.md) |
| A.5.5 | 当局との連絡 | 適用 | 個人データの漏えいは、期限つきで個人情報保護委員会に届け出る義務がある | 漏えいの手順書に届け出の先・期限・書く中身 | `runbook-report` |  | [personal-data-breach.md](../runbooks/personal-data-breach.md) |
| A.5.6 | 専門家の集まりとの連絡 | 適用 | 新しい手口と対策を知るため | 点検の台帳の調べる所(refresh_sources)を月1回読む(/checkup-refresh) | `w-ledger` | `checkup-ledger` | [todo.yaml](../checkup/todo.yaml) |
| A.5.7 | 脅威の情報 | 適用 | 使っている部品の穴を早く知るため | Dependabot の通知・毎週の脆弱性の検査・月1回の世の中の変化の取り込み。届くかの精査は /cve | `w-vuln` `w-ledger` | `github-security` `checkup-ledger` | [vulnerabilities.md](../guides/vulnerabilities.md) [vuln-scan.yml](../../.github/workflows/vuln-scan.yml) |
| A.5.8 | プロジェクトの中のセキュリティ | 適用 | 作る工程の中で守りを決めないと、後から足せない | 仕様に悪用のされ方(STRIDE)・設計書に観点ごとの扱い・未確定事項は人が承認するまでマージしない | `w-decisions` `launch-decisions` |  | [_template.md](../specs/_template.md) [review-viewpoints.md](../review-viewpoints.md) |
| A.5.9 | 情報と資産の目録 | 適用 | 何を守るか分からないと守れない | 列の分類表(全部の列に分類と目的)・個人データの台帳・AWS は Terraform が目録(タグつき) |  |  | [classification.ts](../../apps/api/src/db/classification.ts) [personal-data.md](../db/personal-data.md) [terraform](../../infra/terraform) |
| A.5.10 | 情報と資産の使い方の決まり | 適用 | 使ってよい範囲を決めないと、持ち出しや私用が起きる | 基本方針の「使い方の決まり」・教育で毎年伝える |  |  | [basic-policy.md](policies/basic-policy.md) |
| A.5.11 | 資産の返却 | 適用 | 辞めた人の端末や鍵が残ると、そこから入られる | 辞めるときの手順(基本方針の「人の出入り」)と、四半期ごとの権限の棚卸し(点検 access-review) | `people-changes` `access-review` | `github-collaborators` `aws-iam-users` `aws-iam-roles` | [basic-policy.md](policies/basic-policy.md) |
| A.5.12 | 情報の分類 | 適用 | 扱いの重さを分けないと、全部が軽く扱われる | 列ごとに public / internal / personal / sensitive。要配慮は別のスキーマ(ADR 0018) |  |  | [personal-information.md](policies/personal-information.md) [classification.ts](../../apps/api/src/db/classification.ts) [0018-sensitive-data-isolation.md](../adr/0018-sensitive-data-isolation.md) |
| A.5.13 | 情報の表示(ラベル) | 適用 | 分類が見えないと、扱う人が間違える | 分類は列の分類表と DB の資料(docs/db)に出る。ログは出してよい項目だけ(許可リスト) |  |  | [personal-data.md](../db/personal-data.md) [0019-log-allowlist.md](../adr/0019-log-allowlist.md) |
| A.5.14 | 情報を送る・受け取る | 適用 | 送る途中で読まれる・違う相手に届くのを防ぐ | 通信は TLS だけ。メールは中継(Postfix)から SES へ。書き出しは管理者だけ |  |  | [mail.md](../guides/mail.md) [security.md](../security.md) |
| A.5.15 | アクセスの決まり | 適用 | 誰が何をできるかの決まりが無いと、権限が広がる | 権限の表が正(CI がテストと突き合わせる)。テナントはセッションからだけ決める | `authz-review` |  | [matrix.yaml](../authz/matrix.yaml) [0001-shared-tables-with-rls.md](../adr/0001-shared-tables-with-rls.md) |
| A.5.16 | 識別(ID)の管理 | 適用 | 1人1つの ID でないと、誰がやったか分からない | 利用者は Cognito。運営の人は GitHub・AWS とも個人の ID(共有のアカウントを作らない) |  | `github-collaborators` `aws-iam-users` | [0007-cognito-login-server-side.md](../adr/0007-cognito-login-server-side.md) |
| A.5.17 | 認証の情報(パスワード・鍵) | 適用 | 漏れた鍵とパスワードが、いちばんよく使われる入り口 | 二段階認証(点検 acct-mfa)・秘密の見つけと push の保護・秘密は Secrets Manager。漏れたときの手順書 | `w-secrets` `dep-alerts` `acct-mfa` `key-rotation` | `github-security` `aws-iam-summary` `aws-iam-users` | [secret-leak.md](../runbooks/secret-leak.md) [setup.yml](../../.github/setup.yml) |
| A.5.18 | アクセス権の付け外しと見直し | 適用 | 使わない権限・辞めた人の権限が残る | 四半期ごとの棚卸し(点検 access-review)。毎月の証跡に共同作業者と IAM の利用者 | `people-changes` `access-review` | `github-collaborators` `aws-iam-users` `aws-iam-roles` | [README.md](../checkup/README.md) |
| A.5.19 | 委託先との関係の中のセキュリティ | 適用 | データを預ける先(AWS・GitHub・Sentry など)の守りが、自社の守りになる | 委託先の管理の規程。選ぶとき・年1回の見直し(点検 vendor-review) | `scs-review` `vendor-review` |  | [vendors.md](policies/vendors.md) |
| A.5.20 | 委託先との契約の中のセキュリティ | 適用 | 守る中身を契約に入れないと、求められない | 委託先の管理の規程の「契約で確かめること」(データの場所・再委託・漏えいの連絡・消すこと) | `vendor-review` |  | [vendors.md](policies/vendors.md) |
| A.5.21 | 部品の供給網(サプライチェーン) | 適用 | 依存のパッケージや Action に悪い物が混ざる | Action は SHA で固定・依存の入れ方の守り(危険度「高」)・Renovate・Trivy・脆弱性の精査 | `w-renovate` `dep-renovate` | `github-actions` | [vendors.md](policies/vendors.md) [renovate.json](../../renovate.json) [protected-paths.json](../../.claude/hooks/protected-paths.json) [vulnerabilities.md](../guides/vulnerabilities.md) |
| A.5.22 | 委託先のサービスの見張りと変更 | 適用 | 委託先の変更(値上げ・仕様・事故)で、守りが変わる | 年1回の委託先の見直し・月1回の世の中の変化の取り込み(GitHub・AWS の変更履歴) | `vendor-review` |  | [vendors.md](policies/vendors.md) [todo.yaml](../checkup/todo.yaml) |
| A.5.23 | クラウドのサービスを使うときのセキュリティ | 適用 | 全部をクラウドで動かしている | AWS は Terraform で設定し、Security Hub で採点・GuardDuty で見張る。責任の分担は委託先の管理の規程 | `vendor-review` | `aws-securityhub` `aws-guardduty` `aws-cloudtrail` | [vendors.md](policies/vendors.md) [security-baseline](../../infra/terraform/modules/security-baseline) |
| A.5.24 | 事故の対応の計画と準備 | 適用 | 事故のときに慌てずに動くため | 障害の入口の手順書・知らせの先(点検 notify-route)・攻撃・漏えい・秘密の漏れの手順書 | `notify-route` `runbook-attack` `oncall-rota` |  | [incident.md](../runbooks/incident.md) [attack.md](../runbooks/attack.md) |
| A.5.25 | 出来事の見極めと判断 | 適用 | どれが事故かを決める基準が無いと、遅れる | 障害の手順書の重さの決め方・アラームの手順書 |  |  | [incident.md](../runbooks/incident.md) [alarms.md](../runbooks/alarms.md) |
| A.5.26 | 事故への対応 | 適用 | 止める・直す・知らせるを、決めた順にやるため | 手順書(他社のデータが見えた・個人データの漏えい・攻撃・秘密の漏れ) | `runbook-attack` `runbook-report` `oncall-rota` |  | [tenant-data-leak.md](../runbooks/tenant-data-leak.md) [personal-data-breach.md](../runbooks/personal-data-breach.md) |
| A.5.27 | 事故から学ぶ | 適用 | 同じ事故を繰り返さないため | 振り返りの記録と、再発防止が閉じたかの点検(incident-followups) | `incident-followups` |  | [README.md](../incidents/README.md) |
| A.5.28 | 証拠を集める | 適用 | 事故の後や審査で、何があったかを示すため | 監査ログ(足すだけ)・CloudTrail・毎月の証跡を消せない置き場に(evidence.yml) | `evidence-monthly` | `aws-cloudtrail` | [0013-audit-log.md](../adr/0013-audit-log.md) [evidence.yml](../../.github/workflows/evidence.yml) |
| A.5.29 | 障害の間のセキュリティ | 適用 | 慌てて守りを外さないため | 戻す手順書(守りを外さずに戻す)・本番に書き込む操作は手順書のコマンドを人が打つ |  |  | [deploy-rollback.md](../runbooks/deploy-rollback.md) [db-restore.md](../runbooks/db-restore.md) |
| A.5.30 | 事業を続けるための ICT の備え | 適用 | DB やアカウントが失われても戻せるように | 消せない保管庫のバックアップ・毎月の戻す訓練・管理者を2人に(点検 acct-two-admins) | `acct-two-admins` `restore-first` `handover` | `aws-backup` `drills` `github-collaborators` | [0012-backup-vault-and-restore-drills.md](../adr/0012-backup-vault-and-restore-drills.md) [restore-drill.yml](../../.github/workflows/restore-drill.yml) |
| A.5.31 | 法令・規制・契約の要求 | 適用 | 個人情報保護法・特定商取引法・契約の約束を守るため | 利用規約とプライバシーポリシーの型・同意の記録・年1回の法令の見直し(点検 law-review) | `legal-terms` `plan-seats` `scs-review` `law-review` |  | [personal-information.md](policies/personal-information.md) [legal-documents.md](../guides/legal-documents.md) [0022-legal-documents-and-consent.md](../adr/0022-legal-documents-and-consent.md) |
| A.5.32 | 知的財産権 | 適用 | 使う部品の使用許諾(ライセンス)を守るため | 依存は package.json と pnpm-lock.yaml に固定(使用許諾は依存を足す PR で確かめる) |  |  | [pnpm-lock.yaml](../../pnpm-lock.yaml) |
| A.5.33 | 記録を守る | 適用 | 記録が消える・書き換えられると、何も示せない | 監査ログは足すだけ・証跡は Object Lock・点検の答えは台帳に足すだけ(CI が見張る) | `evidence-monthly` | `checkup-ledger` `compliance-docs` | [personal-information.md](policies/personal-information.md) [0013-audit-log.md](../adr/0013-audit-log.md) [evidence.yml](../../.github/workflows/evidence.yml) |
| A.5.34 | プライバシーと個人を特定できる情報の保護 | 適用 | 個人データを預かる | 個人情報保護規程・個人データの台帳・列の分類・ログの許可リスト・消す期間 | `runbook-report` `legal-terms` `law-review` |  | [personal-information.md](policies/personal-information.md) [personal-data.md](../db/personal-data.md) [data-retention.md](../guides/data-retention.md) |
| A.5.35 | 外からの独立した見直し | 適用 | 自分たちだけでは見落とす | 内部監査(年1回。作った人と別の人)・外部の診断(点検 pentest-yearly) | `pentest-before-launch` `pentest-yearly` `internal-audit` | `checkup-ledger` `compliance-docs` | [internal-audit.md](policies/internal-audit.md) |
| A.5.36 | 決まりを守れているかの確かめ | 適用 | 決めただけでは守られない | 毎週の点検(自動で確かめる・人に聞く)・規程の見直し・内部監査 | `w-ledger` `policies-adopt` `internal-audit` `policy-review` | `checkup-ledger` `compliance-docs` | [internal-audit.md](policies/internal-audit.md) [README.md](../checkup/README.md) |
| A.5.37 | 手順を文書にする | 適用 | 担当者がいなくても回るように | 手順書(docs/runbooks)・引き継ぎの練習(点検 handover) | `handover` `policies-adopt` `policy-review` | `compliance-docs` | [incident.md](../runbooks/incident.md) [playbook.md](../playbook.md) |

## 人の管理策(A.6)

| 番号 | 管理策 | 適用 | 理由 | このキットでの実施 | 点検の項目 | 証跡 | 規程・根拠 |
|---|---|---|---|---|---|---|---|
| A.6.1 | 採用の前の確認 | 適用 | 権限を渡す前に、その人を確かめる | 基本方針の「人の出入り」(雇う前に経歴と誓約を確かめる。法令の範囲で) |  |  | [basic-policy.md](policies/basic-policy.md) |
| A.6.2 | 雇用の条件 | 適用 | 守る責任を、雇う条件に入れる | 雇う契約・就業規則に、秘密を守る義務と規程を守る義務(会社の書類。キットの外) |  |  | [basic-policy.md](policies/basic-policy.md) |
| A.6.3 | 意識・教育・訓練 | 適用 | 決まりを知らない人は守れない | 教育の規程。入るとき+年1回。受けた記録を残す(点検 training) | `training` |  | [training.md](policies/training.md) |
| A.6.4 | 懲戒の手続き | 適用 | 破ったときの扱いを決めておく | 就業規則による(基本方針から指す。会社の書類) |  |  | [basic-policy.md](policies/basic-policy.md) |
| A.6.5 | 辞めた・変わった後の責任 | 適用 | 辞めた後も秘密を守る義務が続く | 辞めるときの手順(権限を外す・誓約)と、権限の棚卸し | `people-changes` | `github-collaborators` `aws-iam-users` | [basic-policy.md](policies/basic-policy.md) |
| A.6.6 | 秘密を守る約束(NDA) | 適用 | 社員・業務委託・委託先と、秘密を守る約束を交わす | 委託先の管理の規程・雇う契約 |  |  | [vendors.md](policies/vendors.md) |
| A.6.7 | 離れた場所での仕事 | 適用 | 家や外から仕事をする前提 | 基本方針の「離れた場所での仕事」(公共の場所で画面を見せない・端末の鍵・本番は AWS のコンソールと手順書から) |  |  | [basic-policy.md](policies/basic-policy.md) |
| A.6.8 | 出来事の報告 | 適用 | 気づいた人が、すぐに知らせられるように | 障害の入口の手順書と知らせの先・外の人からの非公開の脆弱性の報告(GitHub) | `notify-route` |  | [incident.md](../runbooks/incident.md) [setup.yml](../../.github/setup.yml) |

## 物理的な管理策(A.7)

| 番号 | 管理策 | 適用 | 理由 | このキットでの実施 | 点検の項目 | 証跡 | 規程・根拠 |
|---|---|---|---|---|---|---|---|
| A.7.1 | 物理的な境界 | 除外 | キットの既定では事務所の設備を持たない(サーバーは AWS)。設備の守りは委託先の第三者の報告書(SOC 2 など)で確かめる。事務所を持つなら適用にする | — |  |  |  |
| A.7.2 | 入退室の管理 | 除外 | A.7.1 と同じ(事務所を持つなら適用) | — |  |  |  |
| A.7.3 | 事務所・部屋・設備の守り | 除外 | A.7.1 と同じ(事務所を持つなら適用) | — |  |  |  |
| A.7.4 | 物理的な見張り | 除外 | A.7.1 と同じ(事務所を持つなら適用) | — |  |  |  |
| A.7.5 | 災害など物理的な脅威への備え | 除外 | 設備は AWS の責任(複数の AZ に置く。network・aurora の設定)。事務所を持つなら適用 | — |  |  | [network](../../infra/terraform/modules/network) |
| A.7.6 | 守る場所での作業 | 除外 | A.7.1 と同じ(事務所を持つなら適用) | — |  |  |  |
| A.7.7 | 机の上と画面を片づける | 適用 | 家・外で仕事をするので、画面と紙からの漏れがある | 基本方針の「端末」(離れるときは画面に鍵・紙に個人データを書かない) |  |  | [basic-policy.md](policies/basic-policy.md) |
| A.7.8 | 機器の置き場所と守り | 除外 | 自社のサーバーを持たない。端末は A.8.1 で扱う | — |  |  |  |
| A.7.9 | 外に持ち出した資産の守り | 適用 | ノートの端末を持ち歩く | 基本方針の「端末」(ディスクの暗号化・紛失したらすぐ知らせる) |  |  | [basic-policy.md](policies/basic-policy.md) |
| A.7.10 | 記録の媒体(USB など) | 適用 | 個人データを媒体に移すと、なくす | 基本方針の「端末」(個人データを外の媒体に移さない。本番のデータを手元に落とさない) |  |  | [basic-policy.md](policies/basic-policy.md) |
| A.7.11 | 電源などの設備 | 除外 | 設備は AWS の責任。事務所を持つなら適用 | — |  |  |  |
| A.7.12 | 配線の守り | 除外 | 設備は AWS の責任。事務所を持つなら適用 | — |  |  |  |
| A.7.13 | 機器の保守 | 除外 | 自社のサーバーを持たない。端末の更新は A.8.1 で扱う | — |  |  |  |
| A.7.14 | 機器を捨てる・使い回すとき | 適用 | 端末を捨てる・人に渡すときに、中身が残る | 基本方針の「端末」(消してから捨てる・渡す)。クラウドの媒体は AWS の責任 |  |  | [basic-policy.md](policies/basic-policy.md) |

## 技術的な管理策(A.8)

| 番号 | 管理策 | 適用 | 理由 | このキットでの実施 | 点検の項目 | 証跡 | 規程・根拠 |
|---|---|---|---|---|---|---|---|
| A.8.1 | 利用者の端末 | 適用 | 開発の端末から、GitHub と AWS に入れる | 基本方針の「端末」(OS の更新・ディスクの暗号化・画面の鍵)。AI のハーネスは本番の鍵を持たない |  |  | [basic-policy.md](policies/basic-policy.md) [local-guards.md](../guides/local-guards.md) |
| A.8.2 | 特別な権限(管理者) | 適用 | 管理者の権限は、取られると全部が取られる | 本番は Environment の承認のあと・役割は main からだけ・root は使わない(二段階認証)・管理者は2人まで | `gh-envs` `acct-two-admins` `access-review` | `github-environments` `aws-iam-summary` `aws-iam-roles` `github-collaborators` `aws-iam-users` | [setup.yml](../../.github/setup.yml) [github-oidc](../../infra/terraform/modules/github-oidc) |
| A.8.3 | 情報へのアクセスの制限 | 適用 | 他社のデータを見せない・権限の外の物を見せない | テナントの分離(RLS)・権限の表と2社のテスト・サポートの代理ログインは期限と記録つき | `authz-review` |  | [0001-shared-tables-with-rls.md](../adr/0001-shared-tables-with-rls.md) [matrix.yaml](../authz/matrix.yaml) [0014-support-access.md](../adr/0014-support-access.md) |
| A.8.4 | ソースコードへのアクセス | 適用 | コードを書き換えられると、守りが外れる | main は PR 必須・強制 push の禁止・危険度「高」の場所は人の確認(CODEOWNERS とフック) | `w-guards` `w-protection` `gh-protection` | `github-ruleset` `github-collaborators` `github-environments` | [setup.yml](../../.github/setup.yml) [protected-paths.json](../../.claude/hooks/protected-paths.json) |
| A.8.5 | 安全な認証 | 適用 | パスワードだけでは破られる | 利用者は二段階認証・セッションの時間切れ。運営の人は二段階認証(点検 acct-mfa) | `acct-mfa` | `aws-iam-users` `aws-iam-summary` | [0006-account-security.md](../specs/0006-account-security.md) [0017-session-idle-and-absolute-timeout.md](../adr/0017-session-idle-and-absolute-timeout.md) |
| A.8.6 | 容量の管理 | 適用 | 足りなくなって止まる・費用が膨らむ | 台数の自動の増減・DB の上限のアラーム・Actions の分数の点検・予算のアラーム | `w-minutes` `cost-review` |  | [monitoring.md](../guides/monitoring.md) [alarms.md](../runbooks/alarms.md) |
| A.8.7 | 悪いプログラムからの守り | 適用 | 依存や端末から、悪いプログラムが入る | イメージの検査(Trivy)・GuardDuty・端末は OS の守り(基本方針) |  | `aws-guardduty` | [ci.yml](../../.github/workflows/ci.yml) [security-baseline](../../infra/terraform/modules/security-baseline) |
| A.8.8 | 技術的な脆弱性の管理 | 適用 | 部品の穴を、届くかを見て期限つきで直す | Dependabot・Renovate・毎週の検査・/cve の6段の精査と期限 | `w-vuln` `w-renovate` `dep-renovate` `dep-alerts` `major-backlog` `eol` | `github-security` | [vulnerabilities.md](../guides/vulnerabilities.md) [vulns.md](../security/vulns.md) |
| A.8.9 | 設定の管理 | 適用 | 画面で直した設定は、誰が何をしたか残らない | AWS は Terraform・GitHub は .github/setup.yml が正(毎週、外れていないか点検) |  | `github-ruleset` `github-actions` `aws-securityhub` | [terraform](../../infra/terraform) [setup.yml](../../.github/setup.yml) |
| A.8.10 | 情報を消す | 適用 | 要らなくなった個人データを持ち続けない | 消す期間の手引き・解約の削除のコマンド・人ごとの削除 |  |  | [personal-information.md](policies/personal-information.md) [data-retention.md](../guides/data-retention.md) [offboarding.md](../runbooks/offboarding.md) |
| A.8.11 | データを伏せる(マスキング) | 適用 | ログや試しの環境に、本物の個人データを出さない | ログは許可リスト(知らない名前は伏せる)・Sentry に送る前に値を落とす・試しは偽のデータ |  |  | [personal-information.md](policies/personal-information.md) [0019-log-allowlist.md](../adr/0019-log-allowlist.md) [monitoring.md](../guides/monitoring.md) |
| A.8.12 | データの漏れを防ぐ | 適用 | 書き出し・ログ・リポジトリから漏れる | 秘密の見つけと push の保護・gitleaks・書き出しは管理者だけ・ログの許可リスト | `w-secrets` | `github-security` | [ci.yml](../../.github/workflows/ci.yml) [0019-log-allowlist.md](../adr/0019-log-allowlist.md) |
| A.8.13 | 情報のバックアップ | 適用 | 壊れた・消された DB を戻すため | 消せない保管庫に毎日と毎月・毎月の戻す訓練(点検 restore-first) | `restore-first` | `aws-backup` `drills` | [0012-backup-vault-and-restore-drills.md](../adr/0012-backup-vault-and-restore-drills.md) [db-restore.md](../runbooks/db-restore.md) |
| A.8.14 | 処理の設備の冗長化 | 適用 | 1か所の障害で止まらないように | 本番は AZ ごとの NAT・DB は2台・ECS は2台から |  |  | [main.tf](../../infra/terraform/envs/prod/main.tf) |
| A.8.15 | ログを取る | 適用 | 何が起きたかを後から追うため | アプリのログ(許可リスト)・監査ログ(書き込みは自動で記録)・CloudTrail・VPC のフローログ |  | `aws-cloudtrail` | [0013-audit-log.md](../adr/0013-audit-log.md) [logging](../../packages/logging) |
| A.8.16 | 見張り | 適用 | 異常に早く気づくため | アラーム → Slack・外形監視・Sentry・GuardDuty・WAF の数 |  | `aws-guardduty` `aws-securityhub` | [monitoring.md](../guides/monitoring.md) [alarms.md](../runbooks/alarms.md) |
| A.8.17 | 時刻を合わせる | 適用 | ログの時刻がずれると、出来事の順番が分からない | AWS のサービスの時刻(Amazon Time Sync)を使う。保存は UTC(ADR 0005) |  |  | [0005-money-and-time.md](../adr/0005-money-and-time.md) |
| A.8.18 | 特別な権限のプログラム | 適用 | 守りを越えて動ける道具は、使う場面を絞る | 本番の DB に直接つながない・運営のコマンド(解約の削除など)は試し → 確認つき・手順書から人が打つ |  |  | [offboarding.md](../runbooks/offboarding.md) |
| A.8.19 | 本番の環境へのソフトウェアの入れ方 | 適用 | 決めた道だけで本番を変える | イメージは stg で作った物をそのまま・deploy.yml の承認のあと・依存の入れ方は危険度「高」 |  | `github-environments` | [deploy.yml](../../.github/workflows/deploy.yml) [protected-paths.json](../../.claude/hooks/protected-paths.json) |
| A.8.20 | ネットワークの守り | 適用 | 外から届く所を絞る | DB は非公開のサブネット・セキュリティグループで絞る・WAF | `waf-block` |  | [network](../../infra/terraform/modules/network) [waf](../../infra/terraform/modules/waf) |
| A.8.21 | ネットワークのサービスの守り | 適用 | 入口(ALB・CloudFront)の設定で守りが決まる | TLS だけ・WAF の決まり(最初は数える → 止める。点検 waf-block) | `waf-block` |  | [waf](../../infra/terraform/modules/waf) |
| A.8.22 | ネットワークを分ける | 適用 | 本番と試しを分け、1つが破られても広がらないように | stg・prod は別の AWS アカウント・公開と非公開のサブネット |  |  | [main.tf](../../infra/terraform/envs/prod/main.tf) [network](../../infra/terraform/modules/network) |
| A.8.23 | Web の閲覧の制限 | 除外 | キットの既定では、社員の閲覧を絞る道具を入れない(少人数で端末は個人の管理)。人が増えたら適用を考える | — |  |  |  |
| A.8.24 | 暗号の使い方 | 適用 | 通信と保存の中身を守る | 通信は TLS・DB と秘密と置き場は KMS の鍵(年ごとに替える)・クッキーは暗号化 | `key-rotation` |  | [0023-reauth-token-in-encrypted-cookie.md](../adr/0023-reauth-token-in-encrypted-cookie.md) [aurora](../../infra/terraform/modules/aurora) |
| A.8.25 | 安全な開発の流れ | 適用 | 作る流れの中で守りを入れる | 7工程(仕様 → 設計 → 実装 → テスト)・誤りは入った工程から作り直す・ハーネスの3層 | `ai-pr-rework` |  | [README.md](../concepts/README.md) [code-review.md](../guides/code-review.md) |
| A.8.26 | アプリのセキュリティの要求 | 適用 | 作る前に守る中身を決める | 仕様の悪用のされ方(STRIDE)・セキュリティの決まり(番号つき) |  |  | [security.md](../security.md) [_template.md](../specs/_template.md) |
| A.8.27 | 安全な作りの原則 | 適用 | 1つの誤りで全部が破られない作りにする | テナントの分離(RLS)・領域の境界・要配慮は別のスキーマ・2年ごとの作りの見直し(点検 arch-review) | `arch-review` |  | [0001-shared-tables-with-rls.md](../adr/0001-shared-tables-with-rls.md) [0004-domain-boundaries.md](../adr/0004-domain-boundaries.md) |
| A.8.28 | 安全なコードの書き方 | 適用 | よくある穴をコードに入れない | Semgrep の自社ルール・型・Biome・設計とレビューの観点 | `security-review-all` |  | [review-viewpoints.md](../review-viewpoints.md) [ci.yml](../../.github/workflows/ci.yml) |
| A.8.29 | 開発と受け入れの中のセキュリティのテスト | 適用 | 出す前に穴を見つける | 2社のテスト・権限の表の網羅・ファズ・ZAP・外部の診断(点検 pentest-yearly) | `coverage-total` `fuzz-first` `pentest-before-launch` `security-review-all` `pentest-yearly` | `drills` | [security-fuzz.yml](../../.github/workflows/security-fuzz.yml) [zap-api-scan.yml](../../.github/workflows/zap-api-scan.yml) |
| A.8.30 | 外に頼む開発 | 適用 | 業務委託や外の会社が書いたコードも、同じ守りを通す | 外の人の PR も同じ CI と危険度のラベル・外の人の PR の実行は毎回人が見てから |  | `github-actions` | [setup.yml](../../.github/setup.yml) |
| A.8.31 | 開発・試し・本番の環境を分ける | 適用 | 試しの操作で本番を壊さない・本番のデータを試しに使わない | 手元(Docker)・PR ごとの環境・stg・prod を分ける。prod は別のアカウントで、AI の環境から届かない | `w-protection` `gh-envs` | `github-environments` `github-ruleset` | [local-environment.md](../guides/local-environment.md) [main.tf](../../infra/terraform/envs/prod/main.tf) |
| A.8.32 | 変更の管理 | 適用 | 決めた手順を通らない変更を、本番に入れない | 1 Issue = 1 PR・必須のチェック・危険度のラベル・本番は承認のあと | `w-guards` `w-protection` `gh-plan` `gh-protection` `guard-noise` | `github-ruleset` `github-environments` | [setup.yml](../../.github/setup.yml) [pull_request_template.md](../../.github/pull_request_template.md) |
| A.8.33 | 試しの情報 | 適用 | 試しに本物の個人データを使わない | 種データ・偽の Cognito・試作は偽のデータだけ(CI が見張る) |  |  | [prototypes.md](../guides/prototypes.md) [local-environment.md](../guides/local-environment.md) |
| A.8.34 | 監査のための試しのときの守り | 適用 | 診断や監査で、本番を壊さない・データを持ち出させない | 診断は stg に向ける(ZAP)・外部の診断は範囲と期間を決めて契約する |  |  | [zap-api-scan.yml](../../.github/workflows/zap-api-scan.yml) |
