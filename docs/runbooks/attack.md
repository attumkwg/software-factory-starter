# 手順書: 攻撃を受けているかもしれない(総当たり・大量のアクセス・API の悪用)

> 入口: WAF のアラーム `<名前>-waf-hits`([alarms.md](alarms.md#waf-hits))・ログインの失敗や 429 が急に増えた・1社や1つの IP から異常な量・利用者からの「ログインできない」「遅い」。
> **まず「利用者に影響が出ているか」を見る**。出ていれば、原因の特定より先に止める(下の 1〜3 の「止める」)。障害としての進め方(重さ・役割・知らせ・振り返り)は [incident.md](incident.md)。
> 守りの全体像は `docs/security.md` の「ログイン(Cognito)」「見張り」と T-6(1社の暴走を止める)。

## 0. 最初の5分: どれに当たるかを見分ける

1. Slack の `#incident` にスレッドを立て、**気づいた時刻**と入口(どのアラーム・誰の報告)を書く。
2. WAF のログを開く: CloudWatch Logs Insights → ロググループ `aws-waf-logs-<名前>`(例 `aws-waf-logs-sfs-prod`)。

   ```
   fields @timestamp, action, terminatingRuleId, httpRequest.clientIp, httpRequest.country, httpRequest.uri
   | stats count(*) as n by httpRequest.clientIp, httpRequest.uri
   | sort n desc
   | limit 20
   ```

   - WAF が「数えるだけ(count)」の間は、`action` は `ALLOW` のまま。当たった規則は `nonTerminatingMatchingRules`・`ruleGroupList` に出る。
3. 形で見分ける:

   | 見えた形 | 当たる物 | 次 |
   |---|---|---|
   | 少ない IP から `/api/auth/login`(・`/api/auth/password-reset`・確認コード)に、短い間に何度も | **総当たり**(パスワード・確認コードを当てにきている) | 1 |
   | 多い IP・1つの IP から、いろいろなパスに大量に。5xx・`slow` のアラームも鳴る | **大量のアクセス**(落とそうとしている・荒いクローラ) | 2 |
   | ログインした1社(1人)のセッションから、ふつうでない量・順番(一覧を全部なめる・ID を順に変える) | **API の悪用**(取りすぎ・他社のデータを探る) | 3 |
   | `aws-common`・`aws-known-bad-inputs` に当たる変な入力(SQL・パスの探り) | 型どおりの攻撃の試し(多くは自動の探り) | 4 |

4. 迷ったら、重い方として扱う。他社のデータが見えた疑いがあれば、この手順をやめて [tenant-data-leak.md](tenant-data-leak.md) へ。

## 1. 総当たり(ログイン・確認コード)

すでに効いている守り: Cognito が続けて間違えると止める・試しすぎは API が 429 で返す(`docs/security.md` の「パスワードの総当たり」)。**多くは、ここで止まっている**。

1. 止まっているかを見る: API のログで、ログインの 401 と 429 の数(`/ecs/<名前>`)。

   ```
   fields @timestamp, status, path
   | filter path like /\/api\/auth\// and status in [401, 429]
   | stats count(*) as n by bin(5m), status
   ```

2. 狙われているアカウントがあるか: 利用者から「ログインできない(止められた)」の問い合わせが来ていれば、その人には「しばらく待つと入れる」「パスワードの再設定」を案内する(Cognito の止めは時間で解ける)。**誰が狙われたかを、問い合わせ以外の場所(Issue・Slack の公開のチャンネル)に書かない**。
3. 止める(続いているとき): WAF で、その IP を止める。
   - WAF のコンソール → Web ACL `<名前>` → 「IP sets」→ 作る(例 `<名前>-blocked`)→ 止める IP を足す。
   - Web ACL → ルール → 「ルールを追加」→ IP set のルール → 操作「Block」→ 優先度を `rate-limit-per-ip` より上に。
   - Terraform の外で足したルールは、次の `terraform apply` で消える(足している間は apply しない。落ち着いたら Terraform に書く PR を出す)。
4. 当たったかもしれない(ログインが通った)アカウントがあれば、その人のセッションを切り、パスワードの再設定と二段階認証を案内する([mfa-reset.md](mfa-reset.md)・[cognito-login.md](cognito-login.md))。個人データを見られた疑いがあれば [personal-data-breach.md](personal-data-breach.md) の 0 から(**届け出の期限が、知った時点から数え始まる**)。

## 2. 大量のアクセス

すでに効いている守り: WAF の `rate-limit-per-ip`(1つの IP から5分に `rate_limit` 回。既定 2,000)。**ただし WAF が「数えるだけ」の間は止めていない**。

1. 利用者に影響があるか: `target-5xx`・`slow`・`uptime` のアラーム、画面を開く。
2. 止める(影響が出ている・出そう): どれか。
   - **WAF を「止める」にする**(いちばん早い): コンソール → Web ACL `<名前>` → ルール `rate-limit-per-ip` → 操作を「Block」に。管理ルールのまとまりも、必要なら「Override to count」を外す。あとで Terraform の `mode = "block"`(`infra/terraform/envs/<環境>/main.tf` の `module "waf"`)に合わせる PR を出す。
   - **IP・国を止める**: 1 の 3 と同じやり方で IP set か、国(`Geo match`)のルール。
   - **上限を下げる**: `rate_limit` を下げる(Terraform。急ぐならコンソールで変えて、あとで Terraform をそろえる)。
3. 負荷で落ちているなら、増やす: ECS の台数・Aurora の `max_acu`([incident.md](incident.md) の 3)。**攻撃の量に合わせて増やし続けない**(お金がかかり続ける)。止めるのが先。
4. 費用を見る: 止めるまでの間の WAF のリクエスト・ALB・ECS の費用([alarms.md](alarms.md#budget))。

## 3. API の悪用(ログインした人から)

すでに効いている守り: テナントの文脈(RLS)で他社のデータは返らない・クエリは5秒で切れる(`docs/security.md` の T-6)。テナントごとの流量の上限は、まだ無い(PMF の後)。

1. 誰か: API のログで、量の多いテナント(ログの行に `userId` があれば、人まで)。

   ```
   fields @timestamp, tenantId, method, path, status
   | stats count(*) as n by tenantId
   | sort n desc
   | limit 20
   ```

2. 何をしているか: その `tenantId` のパスの並び。404・403 が多い(ID を順に変えて探っている)なら、他社のデータを探っている疑い → [tenant-data-leak.md](tenant-data-leak.md) の 1 で、見えていないことを確かめる。
3. 止める: その人のログインを止める(Cognito のコンソール → ユーザー → 「アクセスを無効にする」。セッションも切る)。会社ごと止めるかは、契約に当たるので**責任者が決める**(相手の会社に連絡するかも)。
4. 正しい使い方(連携・一括の取り込み)で量が多いだけなら、止めずに相手と話す。上限を決める・専用にするは事業の判断(T-6)。

## 4. 型どおりの攻撃の試し(SQL・既知の悪い入力)

- ほとんどは自動の探りで、WAF の管理ルールが止める(数えるだけの間は、API の入力の確かめ・パラメータで渡す SQL が止める)。
- API のログに 5xx が出ていないかだけ見る。5xx が出ているなら、変な入力で落ちている → 再現する入力を Issue にし(**中身は公開の Issue に書かない**)、直す。ファズ(`security-fuzz.yml`)にも同じ形を足す。

## 5. 終わり方

1. 止めるために足した WAF のルール・IP set を、残すか消すかを決める。残すなら Terraform に書く PR を出す(手で足した物は apply で消える)。
2. `<名前>-waf-hits` のしきい値(`alarm_threshold`。既定は5分に100回)が合っていたか。鳴りすぎ・鳴らなすぎなら直す([guides/monitoring.md](../guides/monitoring.md) の表も)。
3. WAF がまだ「数えるだけ」なら、点検の台帳の `waf-block`(止めるに切り替える)を前に進めるか、担当者と決める(`/checkup`)。
4. 利用者に影響が出た・個人データに触れた疑いがあれば、振り返りを書く([incident.md](incident.md) の 6)。
