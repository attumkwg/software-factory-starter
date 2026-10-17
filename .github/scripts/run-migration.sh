#!/usr/bin/env bash
# 移行を ECS の1回きりのタスクで流し、終わるのを待って、失敗ならデプロイを止める。
#   run-migration.sh <クラスター> <移行のタスク定義> <サービス(ネットワークの設定を借りる)> <イメージ>
set -euo pipefail
cluster=$1 family=$2 service=$3 image=$4

# 移行のタスク定義を、新しいイメージで登録し直す
aws ecs describe-task-definition --task-definition "$family" --query taskDefinition \
  | jq --arg image "$image" '.containerDefinitions[0].image = $image
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
            .registeredAt, .registeredBy, .deregisteredAt)' > migrate-task.json
task_def=$(aws ecs register-task-definition --cli-input-json file://migrate-task.json \
  --query taskDefinition.taskDefinitionArn --output text)

# サービスと同じサブネット・セキュリティグループで動かす(DB に届く)
network=$(aws ecs describe-services --cluster "$cluster" --services "$service" \
  --query 'services[0].networkConfiguration' --output json)

task=$(aws ecs run-task --cluster "$cluster" --task-definition "$task_def" --launch-type FARGATE \
  --network-configuration "$network" --started-by "github-${GITHUB_RUN_ID:-manual}" \
  --query 'tasks[0].taskArn' --output text)
echo "移行のタスク: $task"

aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"
code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
  --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$code" != "0" ]; then
  echo "::error::移行が失敗しました(exit $code)。CloudWatch Logs の migrate を見てください。デプロイは止めます"
  exit 1
fi
echo "移行が終わりました"
