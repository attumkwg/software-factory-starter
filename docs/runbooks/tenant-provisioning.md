# 手順書: 申し込みを受けた組織を作る(開通)

> 仕組みは [specs/0026-tenant-provisioning.md](../specs/0026-tenant-provisioning.md)・[ADR 0039](../adr/0039-tenant-provisioning-command.md)。対になる解約は [offboarding.md](offboarding.md)。
> **本番の DB に SQL で組織を足さない**。このコマンドだけを使う(監査ログに残る・試しで前もって確かめられる)。
> 2人で(営業か CS が申込書を読み上げ、本番の AWS に入れる人が打つ)。

## 1. 受け渡し(営業 → CS)

申込書・事前登録の記録から、次の項目を **JSON 1つ** にする。知らない項目(プラン・人数・始まりの日・申込番号など)は入っていてよい(読み飛ばして、項目の名前だけ出る)。

```json
{
  "name": "山田工務店",
  "timeZone": "Asia/Tokyo",
  "mfaRequired": false,
  "admin": { "email": "owner@yamada-koumuten.example", "name": "山田 一郎" },
  "plan": "standard",
  "seats": 10,
  "startDate": "2026-11-01"
}
```

| 項目 | 要るか | 中身 |
|---|---|---|
| `name` | 要る | 組織の名前(画面の上に出る。100文字まで) |
| `timeZone` | なくてよい(`Asia/Tokyo`) | 時刻を見せる時間帯・「1日」の区切り(IANA の名前。`America/Los_Angeles` など) |
| `mfaRequired` | なくてよい(`false`) | 全員に二段階認証を必須にするか(後から管理者が画面「設定」で変えられる) |
| `admin.email` | 要る | 最初の管理者のメールアドレス(この人が Cognito で登録する。大文字は小文字になる) |
| `admin.name` | 要る | 最初の管理者の名前 |

- 渡す前に確かめる: 契約(申込書)がある・最初の管理者のメールアドレスを本人に確かめた(打ち間違いのアドレスでは、誰も入れない)。
- JSON は作業の記録のスレッドに貼らない(名前とメールが入っている)。打つ人に直接渡し、終わったら消す。

## 2. 試し

移行と同じ1回きりのタスクで流す(表の持ち主の接続)。本番のアカウントの人が:

```bash
CLUSTER=<名前>-prod
NETWORK=$(aws ecs describe-services --cluster $CLUSTER --services $CLUSTER \
  --query 'services[0].networkConfiguration' --output json)
APPLICATION='<1 の JSON を1行に>'
aws ecs run-task --cluster $CLUSTER --task-definition $CLUSTER-migrate --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides "$(jq -n --arg a "$APPLICATION" \
    '{containerOverrides:[{name:"migrate",command:["dist/cli.js","create-tenant",$a]}]}')"
```

ロググループ `/ecs/<名前>-prod` の `migrate/…` に1行出る(名前とメールは出ない):

```json
{"mode":"plan","timeZone":"Asia/Tokyo","mfaRequired":false,"ignoredKeys":["plan","seats","startDate"]}
```

- 試しは**本当に作ってから取り消している**。ここで落ちる理由は、本番でも落ちる。
- `ignoredKeys` に、入れたつもりの項目(`timezone` のような書き間違い)が無いか。
- 落ちたとき:

| ログ | どうするか |
|---|---|
| `申し込みが JSON として読めません` | 引用符・カンマ。`echo "$APPLICATION" \| jq .` で確かめる |
| `申し込みの項目が正しくありません: admin.email, timeZone` | 出た項目を直す(値はログに出さない作り) |
| `最初の管理者のメールアドレスは、もうどこかの組織で使われています` | 1人 = 1組織。もう作ってある(2回目を流した)か、その人が別の組織にいる。営業に確かめ、別のアドレスを聞く |

## 3. 本当に作る

2 と同じコマンドに `--execute --confirm-name <組織の名前>` を足し、運営の組織の ID を環境変数で渡す(運営の組織の監査ログにも「作った」を残すため):

```bash
aws ecs run-task --cluster $CLUSTER --task-definition $CLUSTER-migrate --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides "$(jq -n --arg a "$APPLICATION" --arg n "<組織の名前>" --arg s "<運営の組織の ID>" \
    '{containerOverrides:[{name:"migrate",
      command:["dist/cli.js","create-tenant",$a,"--execute","--confirm-name",$n],
      environment:[{name:"SUPPORT_TENANT_ID",value:$s}]}]}')"
```

- 名前は申込書を読み上げてもらって打つ(JSON から写さない)。1文字でも違えば何も作らない。
- 成功するとログに `{"mode":"created","tenantId":"…","adminUserId":"…",…}`。**`tenantId` を控える**(機能フラグ・解約・問い合わせで使う。作業の記録のスレッドに書いてよいのは ID だけ)。
- 作った組織の監査ログと運営の組織の監査ログに `tenant.create`(仕組みが・組織を作った)が残る。

## 4. 最初の管理者に案内する

いまは CS がメールで送る(招待の画面ができたら、仕組みで送る)。文の型:

> 件名: 【<プロダクトの名前>】ご利用の準備ができました
>
> <管理者の名前> 様
>
> <組織の名前> のご利用の準備ができました。次の手順でお入りください。
>
> 1. <アプリの URL>/sign-up を開き、**このメールを受け取ったアドレス**とパスワードで登録してください
> 2. 届いた確認コードを入れてください
> 3. ログインすると、利用規約への同意の画面が出ます(組織として同意いただきます)
> 4. ほかの方を足すときは、このメールに返信してお知らせください
>
> このメールに心当たりが無い場合は、このまま返信してお知らせください。

- **パスワードを運営が決めて送らない**(本人が登録する。運営は Cognito に人を作らない)。
- 「登録したのに入れない」と言われたら [cognito-login.md](cognito-login.md) の「ログインできないと言われたら」(登録したアドレスが申し込みと違う、が多い)。

## 5. 終わったら

- [ ] 管理者が初めてログインした(作った組織の監査ログに `auth.login`。運営の組織の社員が代理ログインで見るか、問い合わせで確かめる)
- [ ] 機能フラグを入れる組織なら [feature-flags.md](feature-flags.md)(控えた `tenantId` で)
- [ ] 作業の記録のスレッドに、誰が・いつ・どの組織 ID を作ったか(名前・メールは書かない)。渡された JSON を消す

## 運営の組織も、これで作れる

環境ごとに1回の「運営(サポート)」の組織([support-access.md](support-access.md) の 1)も、`"mfaRequired": true` にしてこのコマンドで作れる(そのときは `SUPPORT_TENANT_ID` はまだ無いので渡さない)。2人目からの社員は [cognito-login.md](cognito-login.md) の「新しい人を入れる」。
