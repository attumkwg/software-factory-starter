# 手順書: 秘密が漏れた(かもしれない)

> **疑いの段階で入れ替える。** 「使われたか」を調べるのは、入れ替えた後。調べている間に使われる。
> 漏れた先(コミット・ログ・Slack・画面の共有・AI への貼り付け)から消しても、**入れ替えるまでは漏れたまま**(git の履歴・通知・キャッシュに残る)。
> 重さは S1([incident.md](incident.md))。

## 1. 何が漏れたか → どこを見るか

| 秘密 | どこにある | 漏れると何ができる | 入れ替え |
|---|---|---|---|
| セッションの秘密(`SESSION_SECRET`) | Secrets Manager `<名前>/session-secret` | **誰にでもなりすませる**(Cookie を作れる)。受けていない招待のリンクも作れる | 2.1 |
| アプリの DB のパスワード(`app`) | `<名前>/database-url` | DB の全社のデータ(RLS はかかるが、テナントを名乗れば読める) | 2.2 |
| 表の持ち主の DB のパスワード(`app_owner`) | RDS が管理する秘密 `rds!cluster-…` | DB の全部(表を消すことも) | 2.3 |
| SES の SMTP の資格情報 | `<名前>/ses-smtp`(IAM ユーザーのアクセスキー) | 自分のドメインを名乗って迷惑メールを送る(SES が止まる) | 2.4 |
| 人の AWS のアクセスキー・コンソールのパスワード | IAM | その人の権限の全部 | 2.5 |
| `ANTHROPIC_API_KEY` | GitHub の Environment「claude」の秘密 | Claude の API を使われる(費用) | 2.6 |
| GitHub の個人のトークン | その人の GitHub | リポジトリの読み書き(main の保護・環境の承認は越えられない) | 2.6 |
| Sentry の DSN | 画面の HTML(もともと公開) | Sentry に偽の失敗を送られる(枠を使われる) | 2.7(秘密ではないので、悪用されたら) |
| 利用者のパスワード(Cognito) | Cognito の中 | その人として入れる | 2.8 |

GitHub と AWS の間は OIDC なので、**長く使える AWS のキーは GitHub に無い**(漏れる物が無い)。

## 2. 入れ替える

コマンドは prod の env のフォルダ(`infra/terraform/envs/prod`)で。stg も同じ形で。

### 2.1 セッションの秘密

```bash
terraform apply -replace=random_password.session
aws ecs update-service --cluster <名前>-prod --service <名前>-prod --force-new-deployment
```

- **全員がログアウトされる**(作った Cookie が全部使えなくなる)。それが目的。お客さんには「安全のため、もう一度ログインをお願いします」と知らせる。
- 入れ替わりの数分は、古いタスクと新しいタスクが混ざるので、ログインし直しても外れることがある。
- **受けていない招待のリンクも全部使えなくなる**(署名の鍵がこの秘密から作られる。ADR 0040)。お客さんの管理者に「招待を取り消して、招き直してください」と知らせる。漏れていた間に受けられた招待が無いかは、各組織の監査ログの `invitation.accept` で見る。

### 2.2 アプリの DB のパスワード(`app`)

順番が大事(DB の中のパスワードと、秘密の値を、同じ値にそろえる)。数十秒〜数分、新しい接続が失敗する(503)ので、できれば [incident.md](incident.md) の「全体を止める」の中で。

```bash
# 1. 新しいパスワードを作り、秘密(database-url)を書き換える
terraform apply -replace=module.aurora.random_password.app
# 2. 新しい値を読む(画面に出さない・どこにも貼らない)
NEW=$(aws secretsmanager get-secret-value --secret-id <名前>-prod/database-url --query SecretString --output text \
  | sed -E 's#^postgres://app:([^@]+)@.*#\1#')
```

```sql
-- 3. 表の持ち主で(RDS のクエリエディタか CloudShell の VPC 環境)。値は上の $NEW
ALTER ROLE app PASSWORD '<新しいパスワード>';
```

```bash
# 4. API を入れ替える(新しいタスクが新しい秘密を読む)
aws ecs update-service --cluster <名前>-prod --service <名前>-prod --force-new-deployment
```

- 3 と 4 の間、古いタスクの新しい接続は失敗する(持っている接続は使える)。4 を急ぐ。

### 2.3 表の持ち主の DB のパスワード(`app_owner`)

RDS が管理しているので、すぐ回せる(DB の中と秘密の両方を RDS が変える):

```bash
SECRET=$(aws rds describe-db-clusters --db-cluster-identifier <名前>-prod \
  --query 'DBClusters[0].MasterUserSecret.SecretArn' --output text)
aws secretsmanager rotate-secret --secret-id "$SECRET"
```

- 使っているのは移行のタスクだけ(実行のたびに読む)。アプリは止まらない。

### 2.4 SES の SMTP の資格情報

```bash
terraform apply -replace=module.ses.aws_iam_access_key.smtp   # 古いキーは消える
```

Actions → Deploy mail relay をもう一度流す(Postfix が新しい秘密を読む)。送り待ちは EFS にあるので消えない。

- 迷惑メールを送られていないか: SES のコンソール → 送信の数・バウンス率・苦情率(アラーム `ses-*` も見る)。

### 2.5 人の AWS のキー・パスワード

1. IAM → その人 → アクセスキーを**無効にする**(消すのは調べた後)。コンソールのパスワードを変え、MFA をつけ直す。
2. CloudTrail で、そのキーが何をしたか(下の 3)。
3. GuardDuty の見つけ物(Slack の Security Hub の知らせ)も見る。

### 2.6 ANTHROPIC_API_KEY・GitHub のトークン

- Anthropic: Console → API Keys → そのキーを消す → 新しいキーを GitHub の Settings → Environments → `claude` → Environment secrets の `ANTHROPIC_API_KEY` に。使われた量は Console の Usage。
- GitHub のトークン: その人の Settings → Developer settings → トークンを消す。組織の監査ログ(Audit log)で何をしたか。

### 2.7 Sentry の DSN(悪用されたとき)

Sentry → プロジェクトの設定 → Client Keys → 新しいキーを作り、古いキーを無効に → `*.auto.tfvars` の `sentry_dsn` を新しい物にして apply → API と画面を入れ替える(`--force-new-deployment`)。

### 2.8 利用者のパスワード(一部の人)

```bash
aws cognito-idp admin-user-global-sign-out --user-pool-id <プール> --username <メールアドレス>
aws cognito-idp admin-reset-user-password --user-pool-id <プール> --username <メールアドレス>
```

- アプリの Cookie は Cognito とは別に、使い続けていれば**ログインから最大12時間**使える(無操作なら1時間で切れる。サーバー側のセッション保存が無いため。ADR 0017)。すぐ追い出すなら 2.1(全員がログアウト)。

## 3. 使われたかを調べる(入れ替えた後)

| 何を | どこで |
|---|---|
| AWS のキー | CloudTrail → イベント履歴 → 「アクセスキー」で絞る。漏れた時刻より後の操作 |
| DB のパスワード | Aurora のログ(CloudWatch Logs `/aws/rds/cluster/<名前>-prod/postgresql`)。接続元が出るのは、パラメーターの `log_connections` を有効にしているときだけ(いまは既定のまま) |
| セッションの秘密 | アプリのログで、同じ userId が普段と違う所・時間から使われていないか(`fields @timestamp, userId, route, status | filter userId = "…"`) |
| SES | 送信の数の急増 |

**お客さんのデータに触れられた疑いがあれば**、[tenant-data-leak.md](tenant-data-leak.md) へ(連絡の期限がある)。**個人データ(利用者の名前・メールなど)に触れられた疑い**なら、[personal-data-breach.md](personal-data-breach.md) で報告が要るかを判定する。秘密を盗んで使った形なら「不正の目的によるおそれ」に当たり、人数に関係なく報告の対象になる。期限は疑いに気づいた日から数える。

## 4. 漏れた所の後始末

- **git にコミットした**: 入れ替えが先。履歴から消すのは後(消しても、フォークやキャッシュに残る前提で)。gitleaks(CI)で同じ形を止められるか確かめる。
- **ログ・Sentry に出た**: その行の出し方を直す(`docs/guides/error-handling.md` の決まり・`scrub.ts`)。Sentry のその1件を消す。
- **Slack・Issue・AI に貼った**: メッセージを消す。どの AI に貼ったかを記録する。個人データも一緒に貼っていたら [compliance/ai-data.md](../compliance/ai-data.md) の 4。
- 振り返り([incident.md](incident.md) の 6)。「なぜ秘密が手で扱える所にあったか」を必ず書く。
