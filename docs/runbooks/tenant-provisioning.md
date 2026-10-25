# 手順書: 申し込みを受けた組織を作る(開通)

> 仕組みは [specs/0026-tenant-provisioning.md](../specs/0026-tenant-provisioning.md)・[ADR 0039](../adr/0039-tenant-provisioning-command.md)。対になる解約は [offboarding.md](offboarding.md)。
> **本番の DB に SQL で組織を足さない**。このコマンドだけを使う(監査ログに残る・試しで前もって確かめられる)。
> 2人で(CS が申込書を読み上げ、本番の AWS に入れる開発が打つ)。
> **申し込み(管理者の名前・メール)をコマンドの引数に書かない**。非公開の置き場(S3)に置いて、引数はキーだけ(ECS のタスクの引数は CloudTrail に残り、消せない)。

## 1. 受け渡し(営業 → CS → 開発)

申込書・事前登録の記録から、次の項目を **JSON 1つ** にする。知らない項目(始まりの日・申込番号など)は入っていてよい(読み飛ばして、項目の名前だけ出る)。

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
| `plan` | なくてよい(プランを入れない。後から [plans.md](plans.md)) | 申込書のプラン(`@app/shared` の `PLANS` の id)。定義に無ければ試しで止まる |
| `seats` | なくてよい(上限なし) | 申込書の人数(人数の上限) |
| `priceList` | なくてよい(その日の価格表の版) | どの版の価格表で契約したか(`PRICE_LISTS` の id) |
| `priceLockedUntil` | なくてよい(据え置きなし) | 据え置き(この価格表のまま)の期限 `YYYY-MM-DD` |

- 渡す前に確かめる: 契約(申込書)がある・最初の管理者のメールアドレスを本人に確かめた(打ち間違いのアドレスでは、誰も入れない)。
- JSON は作業の記録のスレッドに貼らない(名前とメールが入っている)。打つ人(開発)に直接渡す。

## 2. 置き場に置く

開発が、JSON を手元のファイルにして、申し込みの置き場(Terraform の `module.applications`)に置く。**キーは `applications/<申込番号>.json`**(英数字・`-`・`_` だけ。会社や人の名前を入れない。コマンドが形の違うキーを断る):

```bash
BUCKET=$(terraform -chdir=infra/terraform/envs/prod output -raw applications_bucket)
KEY=applications/A-2026-0012.json
jq . application.json > /dev/null   # JSON として読めるか
aws s3 cp application.json "s3://$BUCKET/$KEY"
rm application.json                 # 手元にも残さない
```

- 置き場は非公開・自前の鍵・TLS だけ。読めるのは移行のタスク(`applications/` の下を読むだけ)と、本番の AWS に入れる人。
- 置いた物は 5 で消す。消し忘れても**7日で消える**(上書き・消した古い版は1日)。

## 3. 試し

移行と同じ1回きりのタスクで流す(表の持ち主の接続)。引数はキーだけ:

```bash
CLUSTER=<名前>-prod
NETWORK=$(aws ecs describe-services --cluster $CLUSTER --services $CLUSTER \
  --query 'services[0].networkConfiguration' --output json)
aws ecs run-task --cluster $CLUSTER --task-definition $CLUSTER-migrate --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides "$(jq -n --arg k "$KEY" \
    '{containerOverrides:[{name:"migrate",command:["dist/cli.js","create-tenant",$k]}]}')"
```

ロググループ `/ecs/<名前>-prod` の `migrate/…` に1行出る(名前とメールは出ない):

```json
{"mode":"plan","timeZone":"Asia/Tokyo","mfaRequired":false,"ignoredKeys":["startDate"]}
```

- 試しは**本当に作ってから取り消している**。ここで落ちる理由は、本番でも落ちる。
- `ignoredKeys` に、入れたつもりの項目(`timezone` のような書き間違い)が無いか。
- 落ちたとき:

| ログ | どうするか |
|---|---|
| `置き場のキーの形が違います` | キーを `applications/<英数字・-・_>.json` にして置き直す |
| `申し込みの置き場から読めません: …(NoSuchKey)` | キーの打ち間違いか、7日たって消えた。`aws s3 ls "s3://$BUCKET/applications/"` で確かめる |
| `申し込みの置き場から読めません: …(AccessDenied)` | キーが `applications/` の下に無いか、移行のタスクに置き場の権限が無い(Terraform の `applications_store`) |
| `申し込みが JSON として読めません` | 引用符・カンマ。手元で `jq .` を通してから置き直す |
| `申し込みの項目が正しくありません: admin.email, timeZone` | 出た項目を直して置き直す(値はログに出さない作り) |
| `最初の管理者のメールアドレスは、もうどこかの組織で使われています` | 1人 = 1組織。もう作ってある(2回目を流した)か、その人が別の組織にいる。営業に確かめ、別のアドレスを聞く |

## 4. 本当に作る

3 と同じキーに `--execute --confirm-name <組織の名前>` を足し、運営の組織の ID を環境変数で渡す(運営の組織の監査ログにも「作った」を残すため):

```bash
aws ecs run-task --cluster $CLUSTER --task-definition $CLUSTER-migrate --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides "$(jq -n --arg k "$KEY" --arg n "<組織の名前>" --arg s "<運営の組織の ID>" \
    '{containerOverrides:[{name:"migrate",
      command:["dist/cli.js","create-tenant",$k,"--execute","--confirm-name",$n],
      environment:[{name:"SUPPORT_TENANT_ID",value:$s}]}]}')"
```

- 名前は申込書を読み上げてもらって打つ(JSON から写さない)。1文字でも違えば何も作らない。組織の名前は引数なので CloudTrail に残る(`delete-tenant` と同じ。管理者の名前・メールは残らない)。
- 成功するとログに `{"mode":"created","tenantId":"…","adminUserId":"…",…}`。**`tenantId` を控える**(機能フラグ・解約・問い合わせで使う。作業の記録のスレッドに書いてよいのは ID だけ)。
- 作った組織の監査ログと運営の組織の監査ログに `tenant.create`(仕組みが・組織を作った)が残る。

## 5. 置き場から消す

作れたら(作らずにやめたときも)、すぐ消す:

```bash
aws s3 rm "s3://$BUCKET/$KEY"
aws s3 ls "s3://$BUCKET/applications/"   # 残っていないか(ほかの申し込みの消し忘れも)
```

- 消した古い版は1日で消える(版の管理があるので、すぐには消えない)。
- 作業の記録のスレッドに「置き場から消した」とキーを書く。

## 6. 最初の管理者に案内する

**仕組みで送る**: 4 で作ると、同じトランザクションで「開通の案内」のメールが積まれ、API の送り出しが最初の管理者に送る(件名「<組織の名前> のご利用の準備ができました」。登録の URL と手順・「設定」→「招待」でほかの人を招けること)。試しでは積まれない。

- 届かないと言われたら [mail-not-delivered.md](mail-not-delivered.md)(出来事の名前は `organizations.tenant_opened`)。迷惑メールのフォルダも見てもらう。
- **パスワードを運営が決めて送らない**(本人が登録する。運営は Cognito に人を作らない)。
- 最初の管理者は招待のリンクではなく、users の行がすでにある(期限は無い。そのメールを Cognito で確かめた本人だけが入れる)。打ち間違いのアドレスで作ったときは、`delete-tenant` で消して作り直す。
- 「登録したのに入れない」と言われたら [cognito-login.md](cognito-login.md) の「ログインできないと言われたら」(登録したアドレスが申し込みと違う、が多い)。

## 7. 終わったら

- [ ] 管理者が初めてログインした(作った組織の監査ログに `auth.login`。運営の組織の社員が代理ログインで見るか、問い合わせで確かめる)
- [ ] 機能フラグを入れる組織なら [feature-flags.md](feature-flags.md)(控えた `tenantId` で)
- [ ] 作業の記録のスレッドに、誰が・いつ・どの組織 ID を作ったか(名前・メールは書かない)。置き場と手元から JSON を消した

## 手元・プレビューで試す

置き場(`APPLICATIONS_BUCKET`)が無い使い捨ての環境(local / test / preview)では、引数を手元のファイルの道すじとして読む:

```bash
pnpm --filter @app/api exec tsx --env-file-if-exists=.env src/cli.ts create-tenant ./application.json
```

## 運営の組織も、これで作れる

環境ごとに1回の「運営(サポート)」の組織([support-access.md](support-access.md) の 1)も、`"mfaRequired": true` にしてこのコマンドで作れる(そのときは `SUPPORT_TENANT_ID` はまだ無いので渡さない)。2人目からの社員は、最初の社員が画面「設定」→「招待」から招く。
