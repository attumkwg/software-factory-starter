# 手順書: アラームが鳴った

> Slack の `#alerts-<環境>` に出たアラームの名前から、ここの見出しへ。**まず「利用者に影響が出ているか」を見る**(画面を開く・ALB の 5xx・Slack の問い合わせ)。出ていれば、直すより先に戻す(前の版へ)。
> 何を見張っているかの一覧は [guides/monitoring.md](../guides/monitoring.md)。

## 最初の3分

1. **いつから**: アラームの知らせの時刻。直前にデプロイ(GitHub の deploy.yml)・Terraform の apply・DB の保守が無かったか。
2. **影響**: 画面を開く。`https://<ドメイン>/readyz` が 200 か。
3. **戻すか**: デプロイの直後なら、まず戻す(ECS のコンソール → サービス → 前のタスク定義で更新)。原因はそのあとで。
4. Slack のスレッドに「見ています」と1行。直したら、何をしたかを1行。

ログは CloudWatch Logs Insights で、`/ecs/<名前>`(API)・`/ecs/<名前>-web`(画面)・`/ecs/<名前>-mail`(Postfix):

```
fields @timestamp, level, message, requestId, err.type, err.message
| filter level in ["error", "fatal"]
| sort @timestamp desc
| limit 50
```

## target-5xx

**api-target-5xx / web-target-5xx**

アプリが 5xx を返している。**デプロイ中なら ECS が自動で前の版に戻す**(bake_time の間)。

- 上のクエリで `err.type` と `message` を見る。`service_unavailable`(503)が多いなら DB 側 → [db-capacity](#db-capacity)・[rds-events](#rds-events)。
- `internal`(500)が多いならこちらのバグ。直前のデプロイを戻す。

## running-tasks

**{api,web,mail}-running-tasks**

動いているタスクが決めた数より少ない。ほぼ必ず [task-stops](#task-stops) と一緒に鳴る。

- ECS のコンソール → サービス → 「イベント」に、立てられない理由が出る(イメージが引けない・秘密が読めない・容量が無い)。
- `mail` だけなら、メールは Postfix の手前(アウトボックス)で待っているので消えない。Postfix を戻せば送られる([mail-not-delivered.md](mail-not-delivered.md))。

## task-stops

タスクが15分に3回以上落ちた(アプリが落ちた・起動できない・ヘルスチェックで外された)。理由は記録に残っている:

```
-- ロググループ /aws/events/<名前>/ecs-task-stops
fields @timestamp, detail.group, detail.stopCode, detail.stoppedReason, detail.containers.0.exitCode, detail.containers.0.reason
| sort @timestamp desc
| limit 20
```

| 理由 | よくある原因 | どうするか |
|---|---|---|
| `Essential container in task exited`・終了コード 1 | 起動時の設定の誤り(`設定が正しくありません`)・受け止められなかった失敗 | API / 画面のログの `fatal` を見る |
| 終了コード 137・`OutOfMemoryError` | メモリが足りない | タスク定義の memory を上げる(Terraform)。漏れなら直前のデプロイを疑う |
| `Task failed ELB health checks` | `/readyz` が 503(API は DB に届かない) | [unhealthy-hosts](#unhealthy-hosts) |
| `CannotPullContainerError` | イメージが引けない(prod から stg の ECR への許可) | stg の `image_pull_account_ids` |
| `ResourceInitializationError` | 秘密が読めない(KMS・Secrets Manager の権限) | 直前の Terraform の変更 |

## unhealthy-hosts

**{api,web}-unhealthy-hosts**

ALB のヘルスチェック(`/readyz`)に落ちている。

- API: `/readyz` は DB に `select 1` を流す。**DB に届かないと落ちる**。API のログの「/readyz: DB に届きません」が10秒に1行出ていれば DB 側 → [rds-events](#rds-events)。
- 画面: 画面は DB を持たないので、落ちるのはプロセスが固まったとき。タスクを1つ止めて(ECS が立て直す)様子を見る。

## elb-5xx

ALB 自身が 5xx を返している = 後ろに受け取れるタスクがいない(502 / 503)か、時間切れ(504)。[running-tasks](#running-tasks)・[unhealthy-hosts](#unhealthy-hosts) を先に見る。504 だけなら [slow](#slow)。

## slow

応答の p95 が2秒超(画面と API の合計)。

- どの道が遅いか: `fields path, durationMs | filter message = "request" | stats pct(durationMs, 95) as p95, count() by path | sort p95 desc`
- 全部が遅い → DB([db-capacity](#db-capacity)・[db-cpu](#db-cpu))。1つの道だけ → その道のクエリ(N+1・索引の抜け)。Aurora の Performance Insights で重いクエリが見える。

## db-capacity

Aurora が上限の容量(`max_acu`)に張りついている。遅くなり、接続も増やせなくなる手前。

- 一時的な山(集計・移行)なら待つ。続くなら、Performance Insights で重いクエリを直すか、`max_acu` を上げる(Terraform。費用が上がる)。

## db-cpu

Aurora の CPU が高い。Performance Insights の「上位の SQL」から。索引の抜け・N+1・全件の読み出しが多い。

## rds-events

**RDS のイベント(failover / failure / maintenance)**

- **failover**: もう1台に切り替わった(prod は2台)。30秒〜1分ほど API が 503 を返し、その後は戻る(アプリは 503 で「少し待ってから」と出す)。戻っていれば何もしなくてよい。理由はイベントの文。
- **failure**: DB に障害。AWS の Health Dashboard を見る。戻らなければ、バックアップから戻す手順(次の PR で書く)。
- **maintenance**: 保守の予定。日時を確かめ、利用者への告知が要るか決める。

## ses-reputation

**ses-bounce-rate / ses-complaint-rate**

メールの評判が落ちている。**SES はバウンス 10%・苦情 0.5% でアカウントごと送れなくする**。

- 届かない宛先に送り続けていないか(登録したまま確認しない人・打ち間違い)。SES のコンソール → 「評価ダッシュボード」・「アカウントレベルの抑制リスト」。
- 苦情が増えたなら、送っている中身と回数を見直す(知らせを送りすぎていないか)。

## budget

**費用(`<名前>-monthly`)**

- AWS の Cost Explorer → 「サービス別」「日別」で、何が増えたか。よくあるのは NAT の通信・ログの量・PR ごとの環境の消し忘れ([guides/automation.md](../guides/automation.md))。
- 使い方が変わって上限が合わなくなったなら、`monthly_budget_usd` を直す。

## security-findings

**Security Hub(HIGH / CRITICAL)**

- GuardDuty の見つけ物(漏れた鍵の利用・不審な通信)なら **事故として扱う**: 鍵を止める → 何が触られたかを CloudTrail で見る。他社のデータに触れた疑いがあれば [tenant-data-leak.md](tenant-data-leak.md)。
- 設定の点検(公開のバケット・暗号化していないもの)なら、Terraform で直して apply。わざとそうしているなら、Security Hub で「抑制」にして理由を書く。

## uptime

**{web,api}-uptime(外形監視)**

外(東京・シンガポール・オレゴン)から開けない。**中のアラームが鳴っていないなら、AWS の中は元気で、手前が壊れている**。

| 一緒に鳴っている | よくある原因 | どうするか |
|---|---|---|
| [running-tasks](#running-tasks)・[elb-5xx](#elb-5xx) | 中が落ちている | そちらを先に |
| 何も鳴っていない | DNS(Route 53 のレコード・ドメインの更新切れ)・証明書・WAF の誤ブロック・ALB のセキュリティグループ | `dig <ドメイン>`・`curl -v https://<ドメイン>/readyz` を手元から。WAF のコンソールで、止めた記録(Sampled requests)を見る |
| `api` だけ | ALB の `/api/*` の振り分け・API のサービスだけ止まっている | ALB のリスナーのルール・API のサービスのイベント |

- アラームと Route 53 の数字はバージニア(us-east-1)にある(Route 53 の決まり)。CloudWatch のコンソールでリージョンを切り替えて見る。
- 地点ごとの結果: Route 53 のコンソール → ヘルスチェック → 「Health checkers」。

## cert-expiry

証明書(ACM)の期限まで30日を切った。ACM は期限の60日前から DNS で確認して自動で更新するので、**ここまで来たら更新が失敗している**。

- ACM のコンソールで証明書の「更新の状態」を見る。多いのは、確認用の CNAME レコード(Terraform の `cert_validation`)が消えた・ドメインのネームサーバーが変わった。
- `terraform plan` で `aws_route53_record.cert_validation` を作り直す差分が出れば apply。

