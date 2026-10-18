# 手順書: 解約した組織のデータを消す

> 仕組みは [specs/0005-offboarding.md](../specs/0005-offboarding.md)・[ADR 0015](../adr/0015-offboarding.md)。消した後に何が・いつまで残るかは [guides/data-retention.md](../guides/data-retention.md)。
> **戻せない操作。2人で**(1人が打ち、1人が読み上げて確かめる)。始める前に、`#incident` ではなく作業の記録のスレッドを立てる。

## 1. 消してよいかを確かめる

- [ ] 契約が終わっている(終了日・解約の申し込みの書面・メール)。**口頭やチャットだけでは消さない**
- [ ] お客さんがデータを書き出したか(画面「設定」→「データの書き出し」)。書き出していなければ、消す前に案内する(消した後は渡せない)
- [ ] 消す組織の ID と名前を、契約の書面と突き合わせた(似た名前の別の組織を消さない)
- [ ] 法律や契約で「残す」と決まっている物が無いか(請求の記録などは、このアプリの外にある前提)

組織の ID は、お客さんの画面の「監査ログ」からは見えない。運営の組織の社員が、代理ログインの画面の上(組織の名前)と API の `/api/me` の `tenantId` で確かめるか、表の持ち主で:

```sql
BEGIN;
SELECT set_config('app.tenant_id', '<組織の ID>', true);
SELECT tenant_id, name, created_at FROM organizations.tenants;
COMMIT;
```

## 2. 試し(何をいくつ消すか)

移行と同じ1回きりのタスクで流す(表の持ち主の接続)。stg の Actions の deploy と同じ役割か、本番のアカウントの人が:

```bash
CLUSTER=<名前>-prod
NETWORK=$(aws ecs describe-services --cluster $CLUSTER --services $CLUSTER \
  --query 'services[0].networkConfiguration' --output json)
aws ecs run-task --cluster $CLUSTER --task-definition $CLUSTER-migrate --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides '{"containerOverrides":[{"name":"migrate","command":["dist/cli.js","delete-tenant","<組織の ID>"]}]}'
```

ロググループ `/ecs/<名前>-prod` の `migrate/…` に1行出る:

```json
{"mode":"plan","tenantId":"…","counts":{"tasks.tasks":120,"projects.projects":8,…},"cognitoSubs":["…","…"]}
```

- 件数が思ったとおりか(0 ばかりなら、ID を取り違えている)。
- `cognitoSubs` を控える(次の 3 で使う)。

## 3. Cognito の利用者を消す(DB より先に)

DB を先に消すと、誰が Cognito のどの人か分からなくなる。2 の `cognitoSubs` を1人ずつ:

```bash
POOL=<ユーザープールの ID>
for sub in <sub1> <sub2> …; do
  name=$(aws cognito-idp list-users --user-pool-id $POOL --filter "sub = \"$sub\"" \
    --query 'Users[0].Username' --output text)
  aws cognito-idp admin-delete-user --user-pool-id $POOL --username "$name"
done
```

## 4. 本当に消す

2 と同じコマンドに、`--execute --confirm-name <組織の名前>` を足し、運営の組織の ID を環境変数で渡す(運営の組織の監査ログに「消した」を残すため):

```bash
aws ecs run-task --cluster $CLUSTER --task-definition $CLUSTER-migrate --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides '{"containerOverrides":[{"name":"migrate",
    "command":["dist/cli.js","delete-tenant","<組織の ID>","--execute","--confirm-name","<組織の名前>"],
    "environment":[{"name":"SUPPORT_TENANT_ID","value":"<運営の組織の ID>"}]}]}'
```

- 名前が1文字でも違えば、何も消さずに止まる(ログに「--confirm-name が組織の名前と違う」)。
- 1つのトランザクションで消すので、途中で失敗したら何も消えていない。失敗の理由を見て、もう一度。
- 成功するとログに `{"mode":"deleted",…}`。運営の組織の監査ログに `tenant.delete`(組織 ID と件数。名前は残らない)。

## 5. 終わったら

- [ ] 2 と同じ「試し」をもう一度流し、「組織がありません」になるのを確かめる
- [ ] お客さんに知らせる: 消した日・**バックアップなどに残る物と、いつ消えるか**([guides/data-retention.md](../guides/data-retention.md) の表をそのまま)
- [ ] 作業の記録のスレッドに、誰が・いつ・どの組織 ID を消したか(名前と中身は書かない)
