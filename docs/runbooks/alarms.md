# 手順書: アラームが鳴った

> Slack の `#alerts-<環境>` に出たアラームの名前から、ここの見出しへ。**まず「利用者に影響が出ているか」を見る**(画面を開く・ALB の 5xx・Slack の問い合わせ)。出ていれば、直すより先に戻す(前の版へ)。
> 何を見張っているかの一覧は [guides/monitoring.md](../guides/monitoring.md)。夜中と休日に誰が見るか・どのアラームなら起こすかは [guides/on-call.md](../guides/on-call.md)(アラームを足したら、ここの見出しと、その 3 の表を一緒に足す)。

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
- 遅いクエリ(アプリから見て 0.5 秒以上。SQL は `$1` の形で、値は入らない): `fields @timestamp, durationMs, rows, sql, requestId | filter message = "時間のかかったクエリがありました" | sort durationMs desc`。同じ形の SQL を数えるなら `| stats count(), pct(durationMs, 95) by sql`。`requestId` で上の `request` の行(どの道か)とつなぐ。
- 503 が増えた・「使用中の DB の接続が切れました」が出た → トランザクションを開いたまま 10 秒止まったリクエストがある(DB が切ってロックを放した)。同じ `requestId` の前後の行で、どこで止まったかを見る(外への呼び出しをトランザクションの中でしていないか)。

## db-capacity

Aurora が上限の容量(`max_acu`)に張りついている。遅くなり、接続も増やせなくなる手前。

- 一時的な山(集計・移行)なら待つ。続くなら、Performance Insights で重いクエリを直すか、`max_acu` を上げる(Terraform。費用が上がる)。

## db-cpu

Aurora の CPU が高い。Performance Insights の「上位の SQL」から。索引の抜け・N+1・全件の読み出しが多い。
遅い SQL は DB のログ(`/aws/rds/cluster/<名前>/postgresql`)にも残る(1秒超。値は伏せてある): `fields @timestamp, @message | filter @message like /duration:/ | sort @timestamp desc | limit 50`

## db-connections

Aurora の接続の数が多い(prod は 1,000本・stg は 250本を超えた。上限は prod 約1,670本・stg 約400本)。上限に届くと、新しい接続が断られて API が 503 になる。

- API の台数を見る(ECS のサービスの「タスク」)。台数 × 10本(プール)+ blue/green の入れ替えの間は2倍。台数の上限(`autoscaling` の `max_count`)が原因なら、上げる前に DB の容量(`max_acu`)と合わせて決める。
- 台数が少ないのに多い → 接続の漏れ。`select usename, application_name, state, count(*) from pg_stat_activity group by 1,2,3 order by 4 desc;`(コンソールのクエリエディタ)で、誰が持っているか見る。

## rds-events

**RDS のイベント(failover / failure / maintenance)**

- **failover**: もう1台に切り替わった(prod は2台)。30秒〜1分ほど API が 503 を返し、その後は戻る(アプリは 503 で「少し待ってから」と出す)。戻っていれば何もしなくてよい。理由はイベントの文。
- **failure**: DB に障害。AWS の Health Dashboard を見る。戻らなければ、バックアップから戻す([db-restore.md](db-restore.md))。
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

> 知らせはバージニア(us-east-1)の topic から、ほかのアラームと同じ Slack のチャンネルに届く(メールも)。届くことは [guides/manual-setup.md](../guides/manual-setup.md) の 4 の 3 で、つないだときに鳴らして確かめる。

**{web,api}-uptime(外形監視)**

外(東京・シンガポール・オレゴン)から開けない。**中のアラームが鳴っていないなら、AWS の中は元気で、手前が壊れている**。

| 一緒に鳴っている | よくある原因 | どうするか |
|---|---|---|
| [running-tasks](#running-tasks)・[elb-5xx](#elb-5xx) | 中が落ちている | そちらを先に |
| 何も鳴っていない | DNS(Route 53 のレコード・ドメインの更新切れ)・証明書・WAF の誤ブロック・ALB のセキュリティグループ・CloudFront(秘密のヘッダーの入れ替えの途中で値が食い違うと、ALB が 404 を返す。[cloudfront-origin.md](cloudfront-origin.md) の 3) | `dig <ドメイン>`・`curl -v https://<ドメイン>/readyz` を手元から。WAF のコンソールで、止めた記録(Sampled requests)を見る |
| `api` だけ | ALB の `/api/*` の振り分け・API のサービスだけ止まっている | ALB のリスナーのルール・API のサービスのイベント |

- アラームと Route 53 の数字はバージニア(us-east-1)にある(Route 53 の決まり)。CloudWatch のコンソールでリージョンを切り替えて見る。
- 地点ごとの結果: Route 53 のコンソール → ヘルスチェック → 「Health checkers」。

## waf-hits

**<名前>-waf-hits**(CloudFront を前に置く既定の形では **<名前>-front-waf-hits**。us-east-1 にあり、外形監視の topic から、ほかのアラームと同じ Slack(とメール)に届く。ログも us-east-1 の `aws-waf-logs-<名前>-front`)

WAF が5分に100回以上(`alarm_threshold`)止めた。WAF が「数えるだけ(count)」の間は、**止めるはずだった**数(実際には通っている)。

- 攻撃かもしれない → [attack.md](attack.md) の 0 で、総当たり・大量のアクセス・API の悪用・型どおりの試しのどれかを見分ける。
- 利用者のふつうのアクセスが当たっている(誤検知)なら、当たった規則を WAF のログで見て(`terminatingRuleId`・`ruleGroupList`)、その規則を「数えるだけ」にする PR を出す。

## sensitive-key

**<名前>-sensitive-key-{other-principals,admin-changes,api-decrypts}**(要配慮個人情報の鍵。`modules/sensitive-data`。ADR 0029)

**要配慮のデータの事故として扱う**(S1 の候補)。値・暗号文・鍵の中身は Slack・Issue に貼らない(貼ってよいのは役割の名前・時刻・件数まで)。AI には件数も渡さない(docs/security.md の AI-6)。

| アラーム | 意味 | まずやること |
|---|---|---|
| `other-principals` | API のタスクの役割**以外**が、要配慮の鍵で復号・暗号化しようとした(断られた物も) | CloudTrail(コンソール → イベント履歴。イベントソース `kms.amazonaws.com`)で、誰が(`userIdentity`)・どこから(`sourceIPAddress`)・どの組織の鍵を(`requestParameters.encryptionContext.tenant_id`)・通ったか(`errorCode` の有無)を見る。人や Actions の役割なら、何の作業かを本人に確かめる。分からなければ [secret-leak.md](secret-leak.md) の型でその役割を止める |
| `admin-changes` | 鍵を消す予約・止めた・鍵のポリシーを変えた・権限の付与(grant) | Terraform の apply の予定どおりなら、plan の差分と同じかを確かめて閉じる。予定に無ければ、**消す予約はすぐ取り消す**(`aws kms cancel-key-deletion --key-id <鍵>`・止めたなら `aws kms enable-key`)。鍵が消えると、全部の組織の要配慮のデータが戻せない(バックアップも) |
| `api-decrypts` | API のタスクが5分にデータ鍵を開いた数が多すぎる(ふつうは 組織の数 × タスクの数 まで) | 大量の持ち出しの疑い。ログ(Logs Insights)で同じ時間の要配慮の API の呼び出しを、組織・利用者ごとに数える。タスクが何度も入れ替わっただけ(デプロイ・落ち続け。[task-stops](#task-stops))なら、組織の数が増えたのに線が古いなら `decrypt_alarm_threshold` を上げる PR |

- 通っていた(`errorCode` が無い)・説明がつかない → [personal-data-breach.md](personal-data-breach.md)(要配慮は1件でも報告の対象)。止血は [incident.md](incident.md) の 3(要配慮の機能を機能フラグで止める)。
- 段を上げる・鍵の扱いは [sensitive-data-tiers.md](sensitive-data-tiers.md)。

## cert-expiry

証明書(ACM)の期限まで30日を切った。ACM は期限の60日前から DNS で確認して自動で更新するので、**ここまで来たら更新が失敗している**。

- ACM のコンソールで証明書の「更新の状態」を見る。多いのは、確認用の CNAME レコード(Terraform の `cert_validation`)が消えた・ドメインのネームサーバーが変わった。
- `terraform plan` で `aws_route53_record.cert_validation` を作り直す差分が出れば apply。

