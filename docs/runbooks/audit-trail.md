# 手順書: 管理操作の記録(CloudTrail)

> **誰が・いつ・どの AWS の操作をしたか**は、ここに残る(アプリの中の「誰が何をしたか」は監査ログ `platform.audit_events`)。
> 記録はロックした S3 に置く(stg・prod とも **governance**・400日)。ロックを外す権限 `s3:BypassGovernanceRetention` は、バケットの方針で決めた人の外の全員に拒否している(既定は誰にも渡さない)。消す・ロックや方針を変えると鳴る。
> 中身は社員の IAM の名前と IP を含む。AI には渡さない(読むのは人。AI に渡すのは件数と出来事の名前まで。[compliance/ai-data.md](../compliance/ai-data.md))。
> 作りは `infra/terraform/modules/audit-trail`。決めた理由は [ADR 0030](../adr/0030-vendor-ledger-ai-data-and-audit-trail.md)。

## 0. 何がどこにあるか

| 物 | 場所(Terraform の出力) | 保存 | 使い道 |
|---|---|---|---|
| 記録(正) | S3 `audit_trail_bucket`(`<名前>-audit-trail-<アカウント>`)の `AWSLogs/<アカウント>/CloudTrail/` | 400日(governance のロック。外す権限は方針で全員に拒否)。90日を過ぎると安い置き場へ | 監査に出す・昔の調べ物(Athena) |
| 同じ記録の写し | CloudWatch Logs `audit_trail_log_group_name`(`/aws/cloudtrail/<名前>`) | 90日 | アラーム・最近の調べ物(Logs Insights) |
| 書き換えの検証 | S3 の `CloudTrail-Digest/` | 記録と同じ | 記録のファイルが後から変えられていないか(下の 5) |
| 鍵 | KMS `alias/<名前>-audit-trail` | 毎年自動で入れ替え | 記録とロググループの暗号化 |

- 取っているのは **管理の出来事の全部**(読みと書き・全部のリージョン・IAM などの世界共通の物も)。KMS の鍵の利用も入る。
- 取っていないのは **データの出来事**(S3 の物の読み書き・Lambda の呼び出し)。量で費用が増えるため。例外は **このバケットの記録を消す・ロックを変える操作**(`DeleteObject`・`DeleteObjects`・`PutObjectRetention`・`PutObjectLegalHold`)だけ。ふだんは0件で、鳴らすために取る。ほかに要るなら `advanced_event_selector` で、対象を絞って足す。
- いまは **stg・prod のアカウントごとのトレイル**。プレビュー(dev)のアカウントと、Organizations の管理アカウントには無い(下の 4)。

## 1. 入れる(apply の前と後)

apply は人が CI で行う(AI は plan まで)。stg を先に入れ、ここの 1〜3 を stg で1回通してから prod。

1. plan で、`module.audit_trail` の物だけが増えることを見る(ほかが消えない)。
2. **prod の前に保存の日数とロックの強さを確かめる**(下の 2)。compliance を選ぶと、最初の記録から保存の日数の間は誰にも消せない(取り消せない)。
3. apply のあと、記録が流れているか:

```bash
aws cloudtrail get-trail-status --name <名前>   # IsLogging が true・LatestDeliveryError が空
aws s3api get-object-lock-configuration --bucket <バケット>   # Mode と Days が思ったとおりか
aws logs describe-log-streams --log-group-name /aws/cloudtrail/<名前> --max-items 1   # 15分以内に流れ始める
```

4. 試しに鳴らす(stg だけ): 下の 3 の「記録を変えた」のアラームが、Slack に来るか。`aws cloudtrail update-trail --name <名前> --enable-log-file-validation`(同じ値で上書きするだけで、出来事 `UpdateTrail` が残る)を打ち、5分ほどで知らせが来ることを見る。

## 2. 保存の日数とロックの強さを決める(prod の apply の前に1回。導入時に決める)

| 決めること | キットの既定 | 変えるなら |
|---|---|---|
| S3 に残す日数(`retention_days`) | **400日**(1年と、年1回の監査の準備の分) | 契約・法令・認証で求められる日数に。**長くする** のは後からでもできる(新しい記録から効く)。**短くする** のは、もう書いた記録には効かない |
| ロックの強さ(`lock_mode`) | stg・prod とも `governance` | 監査・契約で「誰にも消せない」を求められたら prod を `compliance` に(⚠️ 取り消せない。下の注意) |
| ロックを外してよい人(`governance_bypass_principal_arns`) | **空(誰にも渡さない)** | 期限の前に消す必要がある(誤って個人データが入った・訴訟の求め)ときだけ、その作業の役割の ARN を入れて apply。終わったら空に戻す |
| CloudWatch Logs に残す日数(`log_retention_days`) | 90日 | 長い調べ物は S3(Athena)で足りる。ここは費用で決める |

- **governance で守っている物**: ロックを外して消せるのは `s3:BypassGovernanceRetention` を持つ人だけ。この権限は管理者の IAM の権限(`AdministratorAccess` など)にも含まれるので、**バケットの方針で、決めた人の外の全員に拒否**している。消したい人は、まずバケットの方針を変えることになり、その操作(`PutBucketPolicy`)は記録に残って `trail-bucket-changes` が鳴る。
- **governance で守れない物**: root と、バケットの方針を変えられる管理者は、方針を変えてから消せる(鳴るので気づける。痕跡そのものは消されうる)。これを許さないなら compliance。
- ⚠️ compliance のロックは、**AWS のサポートに頼んでも外れない**。バケットも、中の記録が全部期限を過ぎるまで消せない(アカウントを閉じる時もこれだけは残る)。governance → compliance は後からでも変えられる(新しい記録から効く)が、compliance → governance には戻せない。
- キットの既定(stg・prod とも governance・400日・外せる人は空)は持ち主が承認済み(設計書 0017 の U-2)。使う人は、決めた値を U-2 に書く(`pnpm decisions --adopt`)。

## 3. アラームが鳴ったら

アラームの名前は `<名前>-root-usage`・`<名前>-trail-changes`・`<名前>-trail-bucket-changes`(知らせ先は modules/alerts の SNS → Slack)。

**root のアカウントが使われた(`root-usage`)**

1. 本人か確かめる: root のメールアドレスとパスワードを持つ人に「いま root で入ったか」を聞く。請求の画面など、root でしかできない作業の予定があったか。
2. 誰も入っていない・心当たりが無い → **事故として扱う**([incident.md](incident.md) で S1 宣言)。root のパスワードを変え、二段階認証の機器を確かめ、root のアクセスキーがあれば消す。何をしたかを下の 5 の検索で見る。
3. 本人だった → スレッドに「誰が・何のために」を1行残して閉じる。

**記録が止められた・変えられた(`trail-changes`)**

1. 下の 5 の検索で、出来事の名前(`StopLogging`・`DeleteTrail`・`UpdateTrail`・`PutEventSelectors`)・誰が(`userIdentity.arn`)・どこから(`sourceIPAddress`)を見る。
2. Terraform の apply(CI の役割)なら、その apply の PR を確かめて閉じる。
3. それ以外 → **事故として扱う**。痕跡を消す前に記録を止めることが多い。まず `aws cloudtrail start-logging --name <名前>` で戻し(人が打つ)、その人の鍵を止める([secret-leak.md](secret-leak.md))。止まっていた間の操作は、CloudTrail のイベント履歴(90日。トレイルとは別に AWS が残す)で見る。

**記録のバケットで、物が消された・ロックや方針が変えられた(`trail-bucket-changes`)**

1. 下の 5 の検索で `filter eventSource = "s3.amazonaws.com" and requestParameters.bucketName = "<バケット>"`。出来事の名前(`DeleteObject`・`PutObjectRetention`・`PutBucketPolicy`・`PutBucketLifecycle` など)・誰が・どこから を見る。
2. Terraform の apply(CI の役割)で方針・ライフサイクルを変えたなら、その PR を確かめて閉じる。外せる人(`governance_bypass_principal_arns`)に入れた人の、予定した作業なら、スレッドに「誰が・何のために・何件」を残して閉じる。
3. それ以外 → **事故として扱う**(S1)。その人の鍵を止める([secret-leak.md](secret-leak.md))。消された記録は戻らないので、残っている記録(CloudWatch Logs の写し・イベント履歴の90日)で、消される前に何があったかを見る。方針を Terraform の形に戻す(apply し直す)。

## 4. 組織のトレイルへ移る(Organizations を Terraform で持ったら)

いまはアカウントごとのトレイル。アカウントが増えた・管理アカウントやプレビュー(dev)のアカウントの操作も残したい・監査で「全部のアカウント」を求められた、なら組織のトレイルへ移る。

1. **前提**: Organizations の管理アカウント(か、CloudTrail の委任された管理者のアカウント)を Terraform で持つ(`envs/` に1つ足す)。このキットにはまだ無い。
2. 記録の置き場は、できればログ専用のアカウント(管理アカウントとも本番とも別。消す権限を持つ人を分ける)。
3. そのアカウントで同じモジュールを使い、`organization_id = "o-…"` を入れる。組織の全部のアカウント(新しく作った物も)の記録が、1つのバケットの `AWSLogs/<組織の ID>/` に入る。
4. 組織のトレイルが流れているのを 1. の 3 と同じ形で確かめてから、stg・prod の `module "audit_trail"` を外す(**2本目のトレイルの管理の出来事は有料**。二重に払わない)。外したアカウントのバケットは、ロックの期限まで残る(消さない)。
5. 委託先の台帳(docs/compliance/vendors.yaml)の AWS の「CloudTrail」の補足と、この手順書の 0 を直す。

## 5. 調べる(誰が・いつ・何をしたか)

90日以内なら Logs Insights(`/aws/cloudtrail/<名前>` を選ぶ):

```
fields @timestamp, eventSource, eventName, userIdentity.arn, sourceIPAddress, errorCode
| filter eventName = "<出来事の名前>"
| sort @timestamp desc
| limit 100
```

- ある人(鍵)のしたこと: `filter userIdentity.accessKeyId = "<キーの ID>"` か `filter userIdentity.arn like /<ロールの名前>/`
- 断られた操作(権限の外を試した): `filter ispresent(errorCode) and errorCode like /AccessDenied|UnauthorizedOperation/`

90日より前は S3 の記録を Athena で読む(CloudTrail のコンソールの「イベント履歴」→「Athena テーブルを作成」で、バケットを選ぶだけで表ができる)。

**記録が書き換えられていないか**(監査に出す前・事故の後):

```bash
aws cloudtrail validate-logs --trail-arn <audit_trail_arn> --start-time <YYYY-MM-DDT00:00:00Z>
```

「Results requested … : x/x digest files valid, y/y log files valid」なら、その間の記録は書き換えられていない。

- 読んだ記録(社員の名前・IP)は、Issue・PR・AI に貼らない。貼るのは件数と出来事の名前まで。
