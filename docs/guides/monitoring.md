# 見張りと知らせ(監視の基本)

> **PMF の前から置いておく、最小の見張り。** 当番(夜中に起こされる人)はまだ置かない。鳴ったら Slack の `#alerts-prod` に流れ、気づいた人が [runbooks/alarms.md](../runbooks/alarms.md) を見て動く。
> 決めた理由は [ADR 0010](../adr/0010-alerts-to-slack.md)(知らせの道)と [ADR 0011](../adr/0011-sentry-from-logs.md)(Sentry)。
>
> **見張りの分担**: アラーム(1〜4)は「**全体として**おかしい」(落ちた・遅い・DB・費用)。外形監視(表の `uptime`)は「**外から**開けるか」。Sentry(5)は「**この1件が**なぜ失敗したか」(どの API・誰・どの版・スタック)。

## 1. 知らせの道

```
CloudWatch のアラーム ─┐
Security Hub(重い見つけ物)─┤
RDS のイベント ─┼→ SNS(<名前>-alerts。東京。KMS で暗号化)─────┬→ Slack(AWS の公式の連携)
AWS Budgets(費用)─┘                                          │
外形監視(Route 53)→ SNS(<名前>-uptime-alerts。バージニア)───┘→ メール(任意)
```

- 環境ごとに1つ(`modules/alerts`)。stg と prod で **チャンネルを分ける**(`#alerts-stg` / `#alerts-prod`)。stg は見なくてよい日もあるが、prod は必ず見る。
- 鳴ったとき(ALARM)だけでなく、**戻ったとき(OK)も流れる**。戻っていなければ、まだ続いている。
- Slack から AWS を操作はさせない(連携の権限は CloudWatch を読むだけ・ガードレールも同じ)。

## 2. 何を見張っているか

| 名前(`<環境>-…`) | 何が起きている | 既定でいつ鳴る | どこで作る |
|---|---|---|---|
| `api-target-5xx` / `web-target-5xx` | アプリが 5xx を返している | 1分に10回 × 2分 | ecs-service / web-service(デプロイ中なら自動で戻す) |
| `{api,web,mail}-running-tasks` | 動いているタスクが決めた数より少ない | 5分続けて | monitoring |
| `task-stops` | タスクが落ちた・起動できない・ヘルスチェックで外された | 15分に3回 | monitoring(理由は `/aws/events/<名前>/ecs-task-stops` に残る) |
| `{api,web}-unhealthy-hosts` | ALB のヘルスチェックに落ちている(API は DB に届かないと落ちる) | 5分続けて | monitoring |
| `elb-5xx` | ALB 自身が 5xx(後ろに誰もいない) | 1分に5回 × 2分 | monitoring |
| `slow` | 応答の p95 が2秒超 | 15分のうち10分 | monitoring |
| `db-capacity` / `db-cpu` | Aurora が上限の容量に張りつく / CPU が高い | 15分続けて 90% / 80% | monitoring |
| `db-connections` | DB の接続が多い(台数の増やしすぎ・接続の漏れ) | 10分続けて prod 1,000本 / stg 250本 超 | monitoring |
| (RDS のイベント) | DB の切り替え・障害・保守の予定 | その都度 | monitoring |
| `ses-bounce-rate` / `ses-complaint-rate` | メールの評判が落ちている | 5% / 0.1%(SES が止めるのは 10% / 0.5%) | monitoring |
| `<名前>-monthly`(Budgets) | 費用が月の上限の 80% / 月末の見込みが 100% 超 | その都度 | alerts |
| (Security Hub) | GuardDuty・設定の点検の HIGH / CRITICAL | その都度 | security-baseline |
| `uptime-{web,api}` | **外から**開けない(東京・シンガポール・オレゴンから30秒ごとに `/readyz` と `/api/auth/options`) | ほとんどの地点から2分続けて | uptime(アラームはバージニア) |
| (AWS Backup) | DB のバックアップが失敗・中止・期限切れ | その都度 | backup([runbooks/db-restore.md](../runbooks/db-restore.md) の 6) |
| `cert-expiry` | 証明書の期限まで30日を切った(自動の更新の失敗) | 1日1回見る | monitoring |

**数字(しきい値)は最初の目安**。鳴りすぎたら上げる・鳴らなくて困ったら下げる。変えたら、この表も直す。

### 台数の自動調整(API と画面)

CPU の平均が 60% になるように、ECS が台数を増やし・減らす(増やすのは1分・減らすのは5分の間を空けて)。リクエスト数ではなく CPU で見るのは、blue/green でターゲットグループが入れ替わるため。

| 環境 | API | 画面(SSR) | 決め方 |
|---|---|---|---|
| prod | 2〜6台 | 2〜6台 | 最小は AZ ごとに1台。API の上限は DB の接続(6台×10本、入れ替えの間は2倍で120本)が Aurora の上限 1,669本の1割に収まる所 |
| stg | 1〜2台 | 1〜2台 | 小さく |

上限を上げるときは、DB の接続(`db-connections` のしきい値)と費用(下の 4)を一緒に直す。台数は Terraform も deploy.yml も触らない(`desired_count` は最初の数だけ)。

### DB のログ(遅いクエリ)

Aurora のログは CloudWatch Logs の `/aws/rds/cluster/<名前>/postgresql`(30日で消える・鍵で暗号化)。

- **1秒より遅い SQL**(`log_min_duration_statement`。`modules/aurora` の `slow_query_log_ms`)と、**1秒を超えたロック待ち**を残す。
- **値は残さない**: SQL の形(`where id = $1`)だけで、渡した値(`$1` の中身)は出さない(`log_parameter_max_length = 0`)。失敗の詳細(`DETAIL: Key (email)=(…)` のように値が入る行)も出さない(`log_error_verbosity = terse`)。失敗の中身はアプリのログで見る。
- ⚠️ SQL の文字列に値を直に書くと(`sql.raw` など)、その値はログに出る。アプリは値を `$1` で渡す決まり(Semgrep の `no-raw-sql`)。
- 引き方: `fields @timestamp, @message | filter @message like /duration:/ | sort @timestamp desc | limit 50`
- **すでに apply した環境に入れるとき**(人がやる。2つ):
  1. ロググループは RDS が「期限なし」で作っているので、apply の前に Terraform に取り込む: `terraform import 'module.aurora.aws_cloudwatch_log_group.postgresql' /aws/rds/cluster/<名前>/postgresql`(`<名前>` は `sfs-stg` / `sfs-prod`)。取り込まずに apply すると「もうある」で止まる(何も壊れない)。
  2. DB のパラメータグループを付け替えると、**DB の再起動のあとで**効く(それまで設定は前のまま。apply の時点では止まらない)。stg はいつでも。prod は利用の少ない時間に、予備(reader)を再起動 → 切り替え(`aws rds failover-db-cluster`)→ 元の書き込み側(いまは予備)を再起動、の順。止まるのは切り替えの 30秒ほど(API は 503 を返し、戻る。[runbooks/alarms.md](../runbooks/alarms.md#rds-events) の failover と同じ)。

## 3. 使い始める(人が1回だけ)

1. **Slack のワークスペースを AWS に許可する**(stg と prod のアカウントそれぞれで): AWS のコンソール → 「Amazon Q Developer in chat applications」(旧 AWS Chatbot)→ チャットクライアントの設定 → Slack → 許可する。ワークスペースの ID(`T…`)が出る。
2. Slack で `#alerts-stg` と `#alerts-prod` を作る。非公開にするなら `/invite @Amazon Q` で招く。チャンネルの ID(`C…`)はチャンネルの詳細のいちばん下。
3. `*.auto.tfvars` に `slack_team_id` と `slack_channel_id`(と、要るなら `alert_emails`)を入れて apply。
4. **試しに鳴らす**: `aws cloudwatch set-alarm-state --alarm-name <名前>-slow --state-value ALARM --state-reason "試し"`。Slack に出れば通っている(次の評価で OK に戻る)。
5. メールも受けるなら、届いた「AWS Notification - Subscription Confirmation」のリンクを押す(押すまで届かない)。

- **月の上限(`monthly_budget_usd`)** の既定は stg 250ドル・prod 600ドル([getting-started.md](../getting-started.md) の費用の目安から)。使い方に合わせて直す。

## 4. 費用

| もの | 月の目安 |
|---|---|
| アラーム(1環境 15〜20個。式のアラームは使う数ぶん) | 約300〜450円 |
| SNS・Slack 連携・RDS のイベント | ほぼ0円 |
| Budgets | 2つまで無料 |
| 落ちたタスクの記録(ログ) | ほぼ0円(落ちたときだけ書く) |
| 外形監視(Route 53 のヘルスチェック 2つ・HTTPS) | 約450円 |
| DB のログ(遅いクエリ・ロック待ち。30日) | ほぼ0円(遅い SQL があるときだけ書く) |
| 台数の自動調整 | 0円(増えた台数の Fargate の分だけ。[getting-started.md](../getting-started.md) の ④) |

Container Insights(タスクの数・CPU・メモリ)は前から有効(1環境 月 数百円〜)。

## 5. Sentry(アプリの失敗を1件ずつ)

**error 以上のログを、そのまま Sentry の1件にする。** 失敗はいままでどおり `logger.error({ err }, "…")` で残せば、Sentry にも届く。Sentry を直接呼ぶコードは書かない。

```
API・画面のサーバー: logger.error / fatal ─┬→ 標準出力(CloudWatch Logs)
                                       └→ @app/error-reporting(値を落とす・数を絞る)→ Sentry
ブラウザ: 捕まえられなかった失敗・画面の受け皿に落ちたバグ → report-error.ts(値を落とす)→ Sentry
```

| 送る | 送らない |
|---|---|
| 失敗の種類・文(値を伏せたもの)・スタック | リクエストの本文(お客さんのデータ) |
| **どの API か**(`route`。例 `POST /api/projects/:projectId/tasks`。ID を入れる前の形) | URL の `?` 以降・path の中の ID |
| **誰か**(users の ID だけ。Sentry が「何人が困ったか」を数える) | メールアドレス・名前・IP |
| `requestId`・`tenantId`・`traceId`・API の `code`・環境・版(git の SHA) | Cookie・ヘッダー |
| **そのリクエストのログを開くリンク**(Contexts の logs。Logs Insights・前後15分) | パンくず・ローカル変数・ログのほかの項目 |

- **値の落とし方**(`packages/error-reporting/src/scrub.ts`): ログの1行から決めた項目だけを拾い、失敗の文からメールアドレス・`key=value` の値・引用符の中・6桁以上の数字・URL の `?` 以降を伏せる。Sentry は外の会社なので、自分の AWS の中のログより一段きつく絞る。自分の AWS の中のログ(CloudWatch)も、出してよい項目だけ(許可リスト。`packages/logging`・ADR 0019)。Sentry の自動の仕組み(v11 は既定でヘッダー・Cookie・本文・利用者を集める)は全部切ってある。
- **送る数の上限**: 1つのプロセスで1分に30件・同じ失敗は3件まで(DB の再起動で同じ失敗が大量に出ても、Sentry の無料の枠を使い切らない)。ログには全部残る。
- **送らないもの**: 4xx(利用者の側)・409(warn)。画面のサーバーが「API に届かない」はログだけ(API 側の Sentry とアラームで分かる。二重に数えない)。
- **版**: deploy.yml がタスク定義に `SENTRY_RELEASE`(git の SHA)を入れる。Sentry で「この版から増えた」が分かる。
- **ログへのリンク**: Terraform が `LOGS_INSIGHTS_REGION` と `LOGS_INSIGHTS_GROUPS`(API と画面のサーバーのロググループ)を入れる。ブラウザの失敗には付かない(requestId が無い)。
- **来たときの調べ方**: [runbooks/sentry.md](../runbooks/sentry.md)(Sentry の画面 → ログ → 会社と人 → 直す)。

### 使い始める(人が1回だけ)

1. Sentry で組織を作る。**データの置き場所(アメリカ / EU)は作るときにしか選べない**。日本の置き場所は無い。
2. プロジェクトを1つ作る(Node)。stg と prod は同じプロジェクトでよい(`environment` で分かれる)。
3. DSN を `*.auto.tfvars` の `sentry_dsn` に入れて apply。次のデプロイから送られる。
4. プロジェクトの設定 → 「Allowed Domains」に画面のドメインだけを入れる(DSN はブラウザに渡るので、ほかのサイトから送られないように)。
5. 設定 → 「Security & Privacy」で「Data Scrubber」と「Prevent Storing of IP Addresses」をオンにする(二重の守り)。

- 費用(2025 年時点の目安。公式の料金表で確かめる): 無料の Developer プランは1人・月 5,000件まで。チームで使うなら Team プラン(月 26ドル〜)。
- 手元で試すとき: `.env` に `SENTRY_DSN=http://<鍵>@localhost:<ポート>/1` を入れると、手元の受け口(なんでもよい。届いた本文を見る)に送られる。手元とテストでは http を許している。

## 6. まだやっていないこと(段階つき)

| もの | いつ | なぜ後か |
|---|---|---|
| Sentry の新しい種類の失敗を Slack へ | 使い始めて量が分かってから | Sentry の画面の「Alerts」で設定する(コードは要らない) |
| Sentry のソースマップのアップロード | 要るようになったら | API と画面のサーバーはソースマップつきで動くのでスタックは読める。ブラウザは圧縮された位置のまま |
| 本物のブラウザで画面の流れを外から確かめる(CloudWatch Synthetics) | PMF 後 | いまの外形監視は「届くか」だけ。ログインの流れまで見るなら。1環境 月 1,500〜3,000円 |
| アウトボックスの溜まり(送れずに残る件数) | PMF 後 | いまは [runbooks/mail-not-delivered.md](../runbooks/mail-not-delivered.md) の SQL で見る |
| 費用の急な増え方(Cost Anomaly Detection) | PMF 後 | Budgets で月の上限は見ている |
| 当番(PagerDuty など・夜中に鳴らす) | 有料の顧客が付いてから | PMF 前は Slack で十分 |
| ダッシュボード | 要るようになったら | Container Insights と ALB の標準の画面で足りる |
