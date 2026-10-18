#!/usr/bin/env bash
# 戻す訓練: DB を一時の DB に時点復元 → 中身を確かめる → 消す(restore-drill.yml から。手順書 docs/runbooks/db-restore.md)。
#   restore-drill.sh <元のクラスター> <移行の数(リポジトリの _journal.json の entries)>
# 一時の DB の名前は「<元>-restore-drill-<実行の番号>」。役割(IAM)はこの名前の物しか触れない。
# 結果(戻すのにかかった時間・どの時点まで戻せたか・表と行の数)を $GITHUB_STEP_SUMMARY に書く。
set -euo pipefail
src=$1 expected_migrations=$2
drill="${src}-restore-drill-${GITHUB_RUN_ID:-manual}"
instance="${drill}-0"
summary=${GITHUB_STEP_SUMMARY:-/dev/stdout}

cleanup() {
  echo "一時の DB を消します: $drill"
  aws rds delete-db-instance --db-instance-identifier "$instance" --skip-final-snapshot >/dev/null 2>&1 || true
  aws rds wait db-instance-deleted --db-instance-identifier "$instance" 2>/dev/null || true
  aws rds delete-db-cluster --db-cluster-identifier "$drill" --skip-final-snapshot >/dev/null 2>&1 || true
}
trap cleanup EXIT

started=$(date +%s)

# 元の DB の置き場所(サブネット・セキュリティグループ・鍵)と、どこまで戻せるかを読む
read -r subnet_group kms_key latest database < <(aws rds describe-db-clusters --db-cluster-identifier "$src" \
  --query 'DBClusters[0].[DBSubnetGroup, KmsKeyId, LatestRestorableTime, DatabaseName]' --output text)
read -r -a security_groups < <(aws rds describe-db-clusters --db-cluster-identifier "$src" \
  --query 'DBClusters[0].VpcSecurityGroups[].VpcSecurityGroupId' --output text)
echo "時点復元: $src → $drill(戻せる最新の時点 $latest)"

aws rds restore-db-cluster-to-point-in-time \
  --source-db-cluster-identifier "$src" --db-cluster-identifier "$drill" \
  --use-latest-restorable-time \
  --db-subnet-group-name "$subnet_group" --vpc-security-group-ids "${security_groups[@]}" \
  --kms-key-id "$kms_key" \
  --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=2 \
  --no-deletion-protection --tags Key=Purpose,Value=restore-drill >/dev/null
aws rds wait db-cluster-available --db-cluster-identifier "$drill"

# 時点復元はクラスター(データ)だけを作る。読み書きするにはインスタンスが要る
aws rds create-db-instance --db-instance-identifier "$instance" --db-cluster-identifier "$drill" \
  --engine aurora-postgresql --db-instance-class db.serverless >/dev/null
aws rds wait db-instance-available --db-instance-identifier "$instance"
restored=$(date +%s)

# SQL を流すため、Data API と「RDS が作る管理者のパスワード」を有効にする(復元の API では指定できない)
aws rds modify-db-cluster --db-cluster-identifier "$drill" \
  --manage-master-user-password --enable-http-endpoint --apply-immediately >/dev/null
secret=None
for _ in $(seq 1 60); do
  read -r secret http cluster_arn < <(aws rds describe-db-clusters --db-cluster-identifier "$drill" \
    --query 'DBClusters[0].[MasterUserSecret.SecretArn, HttpEndpointEnabled, DBClusterArn]' --output text)
  [ "$secret" != "None" ] && [ "$http" = "True" ] && break
  sleep 10
done
if [ "$secret" = "None" ]; then
  echo "::error::一時の DB で Data API が使えるようになりませんでした"
  exit 1
fi
aws rds wait db-cluster-available --db-cluster-identifier "$drill"

sql() {
  aws rds-data execute-statement --resource-arn "$cluster_arn" --secret-arn "$secret" \
    --database "$database" --sql "$1" --output json
}
# Data API が使えるようになるまで、少し待つことがある
for _ in $(seq 1 12); do
  if sql "SELECT 1" >/dev/null 2>&1; then break; fi
  sleep 10
done

# 1. 移行の記録(表の形が最新か)
migrations=$(sql 'SELECT count(*) FROM drizzle.__drizzle_migrations' | jq -r '.records[0][0].longValue')

# 2. 領域の表と、行の数(RLS は表の持ち主にもかかるので count(*) は 0 になる。ANALYZE で数えた見込みを使う)
sql 'ANALYZE' >/dev/null
tables_json=$(sql "SELECT n.nspname || '.' || c.relname, c.reltuples::bigint
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname IN ('organizations', 'projects', 'tasks', 'platform')
  ORDER BY 1")
table_count=$(jq '.records | length' <<<"$tables_json")
row_total=$(jq '[.records[][1].longValue | if . < 0 then 0 else . end] | add // 0' <<<"$tables_json")
checked=$(date +%s)

{
  echo "## 戻す訓練: $src"
  echo
  echo "| 項目 | 結果 |"
  echo "|---|---|"
  echo "| 戻した時点 | $latest(戻せる最新) |"
  echo "| 使える DB になるまで | $(( (restored - started) / 60 ))分 |"
  echo "| 確かめ終わるまで | $(( (checked - started) / 60 ))分 |"
  echo "| 移行の数 | $migrations(リポジトリは $expected_migrations) |"
  echo "| 領域の表 | $table_count |"
  echo "| 行の数(見込み) | $row_total |"
  echo
  echo "<details><summary>表ごと</summary>"
  echo
  echo "| 表 | 行(見込み) |"
  echo "|---|---|"
  jq -r '.records[] | "| \(.[0].stringValue) | \(if .[1].longValue < 0 then "?" else .[1].longValue end) |"' <<<"$tables_json"
  echo
  echo "</details>"
} >>"$summary"

# 落とすのは「戻せていない」ときだけ。stg は手で出すので、移行の数が main より古いのはよくある
if [ "${migrations:-0}" = "0" ] || [ "$table_count" = "0" ]; then
  echo "::error::戻した DB に表か移行の記録がありません(移行 ${migrations:-0}・表 $table_count)"
  exit 1
fi
if [ "$migrations" != "$expected_migrations" ]; then
  echo "::warning::移行の数が main と違います(戻した DB $migrations / main $expected_migrations)。stg に最新が出ていないだけなら問題ありません"
fi
if [ "$row_total" = "0" ]; then
  echo "::warning::行がありません。stg にデータが無いだけなら問題ありません(種データを入れると、より確かめられます)"
fi
echo "戻せました(使える DB まで $(( (restored - started) / 60 ))分)"
