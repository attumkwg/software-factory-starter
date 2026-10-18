# 手順書: DB を戻す

> **どれで戻すかを先に決める。** 丸ごと戻すと、戻した時点より後の**全社の書き込みが消える**。1社のことなら1社分だけ戻す。
> 戻す作業は2人で(1人が打ち、1人が読み上げて確かめる)。始める前に [incident.md](incident.md) で宣言する。

## 0. どれで戻すか

| 起きたこと | 戻し方 | 失うもの |
|---|---|---|
| ある会社が「昨日消したプロジェクトを戻して」 | **3. 1社分だけ**(その会社の、その物だけ) | なし(ほかの会社には触らない) |
| 移行やバグで、ある表の中身が壊れた・消えた(全社) | **3. の形で表ごと**(壊れた表だけ、壊れる前の値を戻す) | その表の、壊れた後の正しい書き込み(見て決める) |
| DB 全体が壊れた・誰かに消された・広く壊れて直し方が分からない | **2. 丸ごと** | 戻した時点より後の、全社の書き込み |
| 35日より前に戻したい | **6.** 保管庫(毎月の分は1年)から一時の DB を作って、2 か 3 | 同上 |

戻せる範囲:

| 何から | どこまで戻せるか | 細かさ |
|---|---|---|
| Aurora の自動バックアップ(時点復元) | prod 14日・stg 7日(`backup_retention_days`) | **秒単位**(最新は今の5分ほど前まで) |
| AWS Backup の保管庫(毎日) | 35日 | その日の 4:00 |
| AWS Backup の保管庫(毎月) | 1年 | 毎月1日の 5:00 |

## 1. 一時の DB を作る(どの戻し方でも最初にやる)

**元の DB には触らない。** 新しいクラスターに戻して、そこから必要な物を取る。

1. **いつに戻すか**を決める: 壊れる直前の時刻(UTC)。ログ(Logs Insights)で、壊した操作の requestId と時刻を探す。分からなければ、余裕を持って前に。
2. 時点復元(コンソール: RDS → クラスター → 操作 → 「特定の時点への復元」。同じことを CLI で):

```bash
SRC=<名前>-prod                   # 例 sfs-prod(Terraform の出力 db_cluster_identifier)
TMP=$SRC-restore-$(date +%Y%m%d%H%M)
aws rds describe-db-clusters --db-cluster-identifier $SRC \
  --query 'DBClusters[0].[DBSubnetGroup, KmsKeyId, VpcSecurityGroups[].VpcSecurityGroupId]'
aws rds restore-db-cluster-to-point-in-time \
  --source-db-cluster-identifier $SRC --db-cluster-identifier $TMP \
  --restore-to-time 2026-10-18T03:00:00Z \
  --db-subnet-group-name <上の1つ目> --vpc-security-group-ids <上の3つ目> --kms-key-id <上の2つ目> \
  --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=8
aws rds wait db-cluster-available --db-cluster-identifier $TMP
aws rds create-db-instance --db-instance-identifier $TMP-0 --db-cluster-identifier $TMP \
  --engine aurora-postgresql --db-instance-class db.serverless
aws rds wait db-instance-available --db-instance-identifier $TMP-0
```

3. **中を確かめる**: 一時の DB に、表の持ち主(`app_owner`)でつなぐ。パスワードは「その時点の」元の DB のもの(DB の中に入っているので一緒に戻る)。分からなければ、一時の DB で `aws rds modify-db-cluster --db-cluster-identifier $TMP --manage-master-user-password --apply-immediately` を流し、新しく作られた秘密(Secrets Manager の `rds!cluster-…`)を使う。
   - つなぎ方: **CloudShell の VPC 環境**(コンソールの CloudShell → 「VPC 環境を作る」で、DB と同じ VPC・プライベートのサブネット・API のセキュリティグループ)から `psql`。
   - または、Data API: `aws rds modify-db-cluster --db-cluster-identifier $TMP --enable-http-endpoint --apply-immediately` のあと、RDS のクエリエディタ。
   - 見る物: 消えた・壊れた物が、ここでは残っているか。

```sql
-- RLS は表の持ち主にもかかる。見る会社を決めてから(トランザクションの中で)
BEGIN;
SELECT set_config('app.tenant_id', '<会社の tenant_id>', true);
SELECT id, name, created_at FROM projects.projects ORDER BY created_at DESC LIMIT 20;
COMMIT;
```

4. **終わったら一時の DB を消す**(残すと 月 数千円かかる。お客さんのデータの写しでもある):

```bash
aws rds delete-db-instance --db-instance-identifier $TMP-0 --skip-final-snapshot
aws rds wait db-instance-deleted --db-instance-identifier $TMP-0
aws rds delete-db-cluster --db-cluster-identifier $TMP --skip-final-snapshot
```

## 2. 丸ごと戻す(入れ替え)

一時の DB を「本物の名前」に付け替える。接続先(エンドポイント)は名前から決まるので、**アプリの設定も秘密も変えずに**切り替わる。

1. **書き込みを止める**: メンテナンスの画面にする([incident.md](incident.md) の「全体を止める」)。止めずに入れ替えると、入れ替えの途中の書き込みが行方不明になる。
2. 1 の手順で、壊れる直前の時点に一時の DB を作り、確かめる。
3. **壊れた DB の名前を変えて、横に置く**(消さない。後で「戻した時点より後の書き込み」を拾うため):

```bash
aws rds modify-db-cluster --db-cluster-identifier $SRC --new-db-cluster-identifier $SRC-broken --apply-immediately
aws rds modify-db-instance --db-instance-identifier $SRC-0 --new-db-instance-identifier $SRC-broken-0 --apply-immediately
aws rds modify-db-instance --db-instance-identifier $SRC-1 --new-db-instance-identifier $SRC-broken-1 --apply-immediately   # prod は2台
```

4. **一時の DB に、本物の名前を付ける**:

```bash
aws rds modify-db-cluster --db-cluster-identifier $TMP --new-db-cluster-identifier $SRC --apply-immediately
aws rds modify-db-instance --db-instance-identifier $TMP-0 --new-db-instance-identifier $SRC-0 --apply-immediately
```

5. **Terraform で形をそろえる**: `terraform plan`(env の prod)。名前で結び付いているので、新しいクラスターを自分の物として見る。差分(2台目のインスタンス・削除の保護・管理者のパスワードの管理・バックアップの設定)を apply で戻す。**plan に「作り直し(replace)」が出たら止めて相談**。
6. アプリを再起動する(古い接続を捨てる): ECS のサービスを「新しいデプロイを強制」。`/readyz` が 200 か。
7. メンテナンスを解く。お客さんに「何時何分の状態に戻した・それより後の操作はやり直してほしい」を知らせる([incident.md](incident.md) の文面)。
8. `$SRC-broken` は、戻した時点より後の書き込みを拾い終わるまで残す(拾い方は 3 と同じ)。終わったら消す(削除の保護を外してから)。

## 3. 1社分(や1つの表)だけ戻す

一時の DB から、その会社の行だけを取り出して、本物に**足す**。本物の行は上書きしない(その後の正しい書き込みを消さないため)。

1. 1 の手順で一時の DB を作る(消える前の時点)。
2. CloudShell の VPC 環境から、両方の DB につなげるようにする(`psql` で一時の DB と本物)。
3. **取り出す**(一時の DB で。親から子の順に。表の参照の向きは `docs/db/`):

```bash
T=<会社の tenant_id>
# RLS は表の持ち主にもかかるので、つなぐときに会社を決める(app.tenant_id)
for table in projects.projects tasks.tasks; do      # 戻したい物だけ。会社ごと消えたなら organizations.tenants・organizations.users から
  PGOPTIONS="-c app.tenant_id=$T" psql "$TMP_URL" \
    -c "\copy (SELECT * FROM $table WHERE tenant_id = '$T') TO '$table.csv' WITH (FORMAT csv, HEADER)"
done
```

4. **足す**(本物で。1つのトランザクションで。無い行だけを足す):

```sql
BEGIN;
SELECT set_config('app.tenant_id', '<会社の tenant_id>', true);
CREATE TEMP TABLE restore_projects (LIKE projects.projects) ON COMMIT DROP;
\copy restore_projects FROM 'projects.projects.csv' WITH (FORMAT csv, HEADER)
INSERT INTO projects.projects SELECT * FROM restore_projects ON CONFLICT DO NOTHING;
-- 子の表も同じ形で(tasks.tasks)
-- 件数を見てから COMMIT。違ったら ROLLBACK
COMMIT;
```

- **戻す範囲を絞る**: 「消したプロジェクト1つ」なら `WHERE tenant_id = … AND id = …` と、その子(`WHERE project_id = …`)だけ。
- **戻した記録を残す**: 誰の依頼で・何を・何件、を Issue か `#incident` に(行の中身は書かない)。
- **アウトボックス(platform.outbox)は戻さない**(戻すと、昔のメールがもう一度送られる)。
- 終わったら一時の DB と csv を消す(お客さんのデータの写し)。

## 4. 移行で表が壊れたとき

[deploy-rollback.md](deploy-rollback.md) の「移行を戻す」を先に。移行の SQL で戻せない(値を消した・上書きした)ときだけ、ここの 3(表ごと)で、壊れる前の値を取り出して戻す。

## 5. 戻す訓練

| 環境 | いつ | 誰が | どうやって |
|---|---|---|---|
| stg | **毎月1日に自動**(いまは手動。有効にする日は [guides/automation.md](../guides/automation.md)) | `restore-drill.yml` | 戻せる最新の時点に一時の DB を作り、移行の数・表・行の数を確かめて消す。結果(かかった時間・戻した時点)は実行の Summary に。落ちたら Issue |
| prod | **四半期に1回・手で** | 2人 | 下のチェックリスト。本物のお客さんのデータなので自動にしない |

prod の訓練のチェックリスト(結果は Issue に `restore-drill` のラベルで残す。行の中身は書かない):

- [ ] 1 の手順で、1時間前の時点に一時の DB を作れた(**かかった時間**: 分)
- [ ] 表の持ち主でつなげた・移行の数が本物と同じ
- [ ] 1社を選び、プロジェクトとタスクの数が本物の1時間前と合う(Logs Insights で、その1時間の書き込みを差し引く)
- [ ] 6 の手順で、保管庫の最新の毎日の分からも一時の DB を作れた
- [ ] 一時の DB を全部消した
- [ ] 手順書と違った所を直した(この PR で)

**目安**(訓練の結果で直す): 一時の DB ができるまで 15〜30分(大きさしだい)。最新の時点は5分ほど前まで。

## 6. 保管庫(AWS Backup)から戻す・バックアップの失敗が来たら

**保管庫から一時の DB を作る**(35日より前・時点復元が使えないとき): AWS Backup → 保管庫 `<名前>-db` → 復旧ポイントを選ぶ → 「復元」→ 新しいクラスターの名前に `$TMP` を入れ、元の DB と同じサブネットのグループ・セキュリティグループ・鍵を選ぶ。できたクラスターにインスタンスを1つ足す(1 の `create-db-instance`)。あとは 2 か 3。

**「バックアップが FAILED」の知らせ**(Slack):

- AWS Backup → ジョブ → 失敗したジョブの「状態のメッセージ」。多いのは、DB が止まっていた(stg の 0 ACU は問題ない)・役割の権限・鍵。
- 1回なら次の日の分を見る。2日続けて失敗したら直す(Aurora の自動バックアップはその間も動いている)。

**保管庫のロック**:

- stg は governance(外せる)、prod は **compliance**: apply してから3日を過ぎると、**ロックも保存の期間も、root でも AWS のサポートでも変えられない**。保存の期間が過ぎるまで、復旧ポイントは消せない(誤って・乗っ取られて消される、を防ぐため)。
- prod に初めて apply したら、**3日のうちに**: 保管庫の名前・毎日が35日・毎月が365日・バックアップが1回取れたこと、を確かめる。違っていたら3日以内に直す。
