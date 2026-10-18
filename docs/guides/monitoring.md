# 見張りと知らせ(監視の基本)

> **PMF の前から置いておく、最小の見張り。** 当番(夜中に起こされる人)はまだ置かない。鳴ったら Slack の `#alerts-prod` に流れ、気づいた人が [runbooks/alarms.md](../runbooks/alarms.md) を見て動く。
> 決めた理由は [ADR 0010](../adr/0010-alerts-to-slack.md)(知らせの道)と [ADR 0011](../adr/0011-sentry-from-logs.md)(Sentry)。
>
> **2つの見張りの分担**: アラーム(1〜4)は「**全体として**おかしい」(落ちた・遅い・DB・費用)。Sentry(5)は「**この1件が**なぜ失敗したか」(スタック・どの版から・どのリクエスト)。

## 1. 知らせの道

```
CloudWatch のアラーム ─┐
Security Hub(重い見つけ物)─┤
RDS のイベント ─┼→ SNS(<名前>-alerts。KMS で暗号化)─┬→ Slack(AWS の公式の連携)
AWS Budgets(費用)─┘                                  └→ メール(任意)
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
| (RDS のイベント) | DB の切り替え・障害・保守の予定 | その都度 | monitoring |
| `ses-bounce-rate` / `ses-complaint-rate` | メールの評判が落ちている | 5% / 0.1%(SES が止めるのは 10% / 0.5%) | monitoring |
| `<名前>-monthly`(Budgets) | 費用が月の上限の 80% / 月末の見込みが 100% 超 | その都度 | alerts |
| (Security Hub) | GuardDuty・設定の点検の HIGH / CRITICAL | その都度 | security-baseline |

**数字(しきい値)は最初の目安**。鳴りすぎたら上げる・鳴らなくて困ったら下げる。変えたら、この表も直す。

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
| 失敗の種類・文(値を伏せたもの)・スタック・`requestId`・`tenantId`・`traceId`・API の `code`・環境・版(git の SHA) | リクエストの本文・Cookie・ヘッダー・URL の `?` 以降・利用者(メールアドレスなど)・パンくず・ローカル変数・ログのほかの項目 |

- **値の落とし方**(`packages/error-reporting/src/scrub.ts`): ログの1行から決めた項目だけを拾い、失敗の文からメールアドレス・`key=value` の値・引用符の中・6桁以上の数字・URL の `?` 以降を伏せる。Sentry は外の会社なので、自分の AWS の中のログより一段きつく絞る。Sentry の自動の仕組み(v11 は既定でヘッダー・Cookie・本文・利用者を集める)は全部切ってある。
- **送る数の上限**: 1つのプロセスで1分に30件・同じ失敗は3件まで(DB の再起動で同じ失敗が大量に出ても、Sentry の無料の枠を使い切らない)。ログには全部残る。
- **送らないもの**: 4xx(利用者の側)・409(warn)。画面のサーバーが「API に届かない」はログだけ(API 側の Sentry とアラームで分かる。二重に数えない)。
- **版**: deploy.yml がタスク定義に `SENTRY_RELEASE`(git の SHA)を入れる。Sentry で「この版から増えた」が分かる。

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
| 外からの死活の確認(Route 53 のヘルスチェック・Synthetics) | PMF 後 | 内側のアラームで「落ちた」は分かる。DNS・証明書の外れは ACM の自動更新に任せている |
| アウトボックスの溜まり(送れずに残る件数) | PMF 後 | いまは [runbooks/mail-not-delivered.md](../runbooks/mail-not-delivered.md) の SQL で見る |
| 費用の急な増え方(Cost Anomaly Detection) | PMF 後 | Budgets で月の上限は見ている |
| 当番(PagerDuty など・夜中に鳴らす) | 有料の顧客が付いてから | PMF 前は Slack で十分 |
| ダッシュボード | 要るようになったら | Container Insights と ALB の標準の画面で足りる |
