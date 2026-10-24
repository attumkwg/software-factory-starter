# 利用の記録を数える・古い記録を消す

> 仕様: [specs/0012](../specs/0012-feature-flags-and-usage.md)(「利用の記録」)・仕組み: [guides/feature-flags.md](../guides/feature-flags.md) の「使われたかを測る」。
> `usage-report` は**読むだけ**。`usage-purge --execute` は**本番の DB から消す操作**(戻せない)。どちらも人が打つ。AI は打たない。

ECS の API のイメージで、移行と同じ接続(表の持ち主)・`SUPPORT_TENANT_ID` を渡して流す(`legal-notify` と同じ)。

## 数える(賭けの線を測る)

1. 機能の名前と、何週ぶん見るかを決める(既定 8週・最大 60週):
   ```bash
   node dist/cli.js usage-report morning-digest --weeks 8
   ```
   `{"mode":"report","feature":"morning-digest","since":"2026-09-07","until":"2026-10-30","tenantsTotal":12,"tenantsEnabled":8,"weeks":[{"week":"2026-09-07","tenants":5,"users":11},…]}`
   - `tenantsTotal` … 数えた組織(運営の組織は除く)
   - `tenantsEnabled` … いまその機能が入っている組織
   - `weeks` … 週(月曜から)ごとの、使った組織の数と人の数(代理ログインの社員・運営の組織の人は入らない)
2. 賭けの小石には**割合**で書く(「入れた組織の 75% が4週続けて使った」)。組織の名前・ID・数そのものは書かない(`docs/guides/bets-and-assets.md`)。
3. 出力は数だけ(組織と人の ID は出ない)。どの組織が使っていないかを知りたいときは、話を聞く(賭けの `psf` の手)。

## 古い記録を消す(月1回)

保存期間は **400日**(`apps/api/src/usage/command.ts` の `USAGE_RETENTION_DAYS`。設計書の U-3)。

1. 試し(数えるだけ):
   ```bash
   node dist/cli.js usage-purge
   ```
   `{"mode":"plan","days":400,"before":"2025-09-25","count":1234}`。`before` より前の日の記録を消す。
2. 件数がおかしくないか(急に多い・少ない)を見て、消す:
   ```bash
   node dist/cli.js usage-purge --execute
   ```
   `{"mode":"purged",…}`。組織ごとに消すので、途中で止まっても流し直せばよい。
3. 消した日と件数を運営の記録(チケットなど)に残す。

## 記録

- 記録は `platform.feature_usage`(組織・人の ID・機能・日だけ)。解約で組織のほかのデータと一緒に消える。
- バックアップの中には、バックアップの保存期間だけ残る([guides/data-retention.md](../guides/data-retention.md))。
