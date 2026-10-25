# 認証の準備(P マーク・ISMS・SOC 2)の入口

> 認証で求められる「誰に・何を預け、どう守り、何が残っているか」を、ここから辿る。**正はコードとこのフォルダのファイル**で、審査に出す一覧はそこから作る(手で写さない)。
> 法令と認証の当てはめは「分かる範囲で」。取ると決めたら、専門家(審査機関・弁護士)と確かめる。部品を残すかは `/tailor`(カタログの `certification-prep`)。

## 中身

| 物 | 何か | 正 | 確かめ方 |
|---|---|---|---|
| [委託先の台帳](vendors.yaml)(人が読む一覧: [vendors.md](vendors.md)) | 外の会社ごとに、預け方・国・渡す区分・契約(DPA)・第三者の認証・消え方 | `vendors.yaml` | `pnpm vendors`(CI。コードの SDK・Terraform の AWS のサービス・Actions が台帳にあるか) |
| [AI に渡すデータの決まり](ai-data.md) | 本番の個人データは渡さない(ID と集計まで)・要配慮は一切。出どころごとの表と、渡してしまったとき | `docs/security.md` の AI-6 | 台帳の AI の会社に personal・sensitive が無いか(`pnpm vendors`) |
| 管理操作の記録(CloudTrail) | AWS の操作を、ロックした S3 に400日(消す・方針を変えると鳴る) | `infra/terraform/modules/audit-trail` | 手順書 [runbooks/audit-trail.md](../runbooks/audit-trail.md)(入れ方・調べ方・書き換えの検証) |

足すときは、この表に1行(何か・正・確かめ方)。

## ほかの場所にある物(認証で聞かれる順)

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

## 使い始めたらやること

1. **台帳を自分の契約に書き直す**: `vendors.yaml` の `contract.dpa`(結んだ日・プラン)・`country`(Sentry などは置き場所を選んだか)・`checked_on`。使わない会社は `status: ended`。直したら `pnpm vendors --write`。
2. **越境の扱いを専門家に確かめる**: 米国の委託先(AI・Sentry・GitHub・Slack)に ID を渡すことを、プライバシーポリシーにどう書くか(設計書 0017 の U-1)。
3. **管理操作の記録の保存の日数とロックの強さを決めてから、prod に apply**(手順書 audit-trail.md の 2。既定は governance。誰にも消せなくするなら compliance)。
4. 年に1回、台帳を見直す(会社の認証・約款・置き場所が変わっていないか)。`checked_on` を直す。
