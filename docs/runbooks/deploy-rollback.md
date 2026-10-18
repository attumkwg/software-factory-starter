# 手順書: デプロイ・移行を戻す

> **アプリは戻す、DB は戻さない(先へ直す)**が基本。移行は「足すだけ」の決まり(`.claude/skills/db-migration`)なので、前の版のアプリは新しい表の形でも動く。
> 迷ったら [incident.md](incident.md) で宣言してから。

## 1. アプリを前の版に戻す

### 1.1 デプロイの途中(切り替えから bake の間)

- **5xx のアラームが鳴れば、ECS が自動で前の版に戻す**(何もしなくてよい)。Slack に `…-target-5xx` が出て、すぐ OK に戻る。
- アラームは鳴っていないが、おかしい(画面が崩れた・ある操作だけ失敗する)なら、手で止めて戻す:

```bash
CLUSTER=<名前>-prod; SERVICE=$CLUSTER          # 画面は $CLUSTER-web
arn=$(aws ecs list-service-deployments --cluster $CLUSTER --service $SERVICE \
  --status IN_PROGRESS --query 'serviceDeployments[0].serviceDeploymentArn' --output text)
aws ecs stop-service-deployment --service-deployment-arn "$arn" --stop-type ROLLBACK
```

### 1.2 デプロイが終わった後

前のタスク定義(1つ前の版)で、サービスを更新する。blue/green で切り替わるので、止まらずに戻る。

```bash
CLUSTER=<名前>-prod
aws ecs list-task-definitions --family-prefix $CLUSTER-web --sort DESC --max-items 3   # 画面
aws ecs list-task-definitions --family-prefix $CLUSTER --sort DESC --max-items 3       # API
# 1つ前の番号(:41 など)を確かめてから
aws ecs update-service --cluster $CLUSTER --service $CLUSTER-web --task-definition $CLUSTER-web:<前の番号>
aws ecs wait services-stable --cluster $CLUSTER --services $CLUSTER-web
aws ecs update-service --cluster $CLUSTER --service $CLUSTER --task-definition $CLUSTER:<前の番号>
```

- **戻す順番は「画面 → API」**(出すときの逆)。新しい画面は新しい API を前提にしていることがあるので、API を先に戻すと画面が壊れる。
- どの版か: タスク定義の環境変数 `SENTRY_RELEASE`(git の SHA)。`git log <前の SHA>..<今の SHA>` で、戻すと消える変更が分かる。
- 戻したら、Sentry の件数が止まったか・アラームが OK に戻ったかを見る。
- **次の deploy.yml は、また新しい版を出す**。直す PR がマージされるまで、deploy.yml を流さない(`#incident` に書いておく)。

### 1.3 メールの中継(Postfix)

`deploy-mail-relay.yml` で出した物は、同じく前のタスク定義で `update-service`(サービス `<名前>-prod-mail`)。送り待ちは EFS にあるので、入れ替えても消えない。

## 2. 移行(DB の形)を戻す

### 2.1 移行が失敗した(deploy.yml が「移行が失敗しました」で止まった)

- **アプリはまだ入れ替わっていない**(移行の後にアプリを出す順番)。お客さんには影響が無い。
- 移行は**まとめて1つのトランザクション**で流れるので、途中で失敗したら何も入っていない。確かめる:

```sql
-- 表の持ち主で。入っている移行の最後
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 3;
```

- 原因はロググループ `/ecs/<名前>` の `migrate/…` の行。よくあるのは:

| 原因 | どうするか |
|---|---|
| `lock_timeout`(5秒でロックが取れなかった) | 使われていない時間に deploy.yml をもう一度流す |
| 既にある値と合わない(NOT NULL・一意・型の変換) | 移行を直す PR を出す(段階に分ける。skill の 1) |
| `CREATE INDEX CONCURRENTLY` の途中で失敗 | これだけはトランザクションの外。壊れた索引が残るので `DROP INDEX CONCURRENTLY IF EXISTS <名前>;` してから流し直す |

### 2.2 移行は通ったが、間違っていた

- **前の版のアプリに戻すだけで済むか**を先に見る(足すだけの移行なら、ほぼ済む)。
- 形を戻すなら、**逆の移行を新しく書いて出す**(Drizzle に「戻す」移行は無い)。
- 🔴 **やってはいけない**: 流した移行のファイルを書き換える・消す / `drizzle.__drizzle_migrations` の行を手で消す(次から本番と手元で表の形がずれる)。
- 移行が値を消した・上書きした(`DROP COLUMN`・`UPDATE`)なら、逆の移行では戻らない → [db-restore.md](db-restore.md) の 3(表ごと)で、移行の直前の値を取り出す。

## 3. Terraform の apply を戻す

- 戻す PR(revert)を出して、plan を見てから apply。**plan に「作り直し」や「消す」が出たら止める**(特に DB・保管庫・KMS の鍵)。
- DB は削除の保護があるので、apply で消えることはない(prod)。消えそうな plan が出たら、それ自体が事故の手前。
- バックアップの保管庫(prod)は compliance のロックで、3日を過ぎたら戻せない([db-restore.md](db-restore.md) の 6)。

## 4. 戻した後

- 何を戻したか(版・時刻・理由)を `#incident` のスレッドに。
- 直す PR には「なぜ CI とレビューを通ったか」と、それを止めるテストを足す([incident.md](incident.md) の 6)。
