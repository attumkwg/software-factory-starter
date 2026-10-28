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
| 試しの `adminOtherMemberships` が1以上 | 最初の管理者は、ほかの組織にも所属している(1人が複数の組織に入れる。ADR 0066)。**同じ申し込みを2回流していないか**を2人で確かめる(作業の記録で、同じ申込番号の組織 ID が無いか)。2回目でなければそのまま作ってよい |

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

## 事前登録から(公開の LP で登録した会社)

公開の LP で事前登録し、確認のメールを開いた(確認済みの)会社が申し込んだときは、`--from-pre-registration <事前登録の ID>` を足す(設計書 0025 の 5)。組織の名前と最初の管理者のメールは、**本人が確認した事前登録の値**で埋まる。作った後に、事前登録は「組織にした」(`converted`)になり、運営の組織の監査ログに `pre_registration.converted`(作った組織の ID)が残る。

1. **事前登録の ID を受け取る**: 営業・CS が `pre-registrations-report` の行ではなく、本人とのやり取り(確認のメールの宛先と同じ人からの申し込み)で、どの登録かを決める。運営がそのアドレスを `pre-registrations-find` に入れて、ID と状態を引く([pre-registrations.md](pre-registrations.md) の「アドレスから登録を探す」。DB に SQL を打たない)。開発は ID だけを受け取る(メール・会社名を作業の記録に書かない)。
2. **申込書はいつもどおり置く**(上の 2)。会社名(`name`)と管理者のメール(`admin.email`)は**書いても書かなくてもよい**。書いたら事前登録と同じでなければ止まる(取り違えの防止。どの項目が違ったかだけが出る)。`--confirm-name` に打つ名前は申込書から読み上げるので、申込書には会社名を書いておく。
3. **試し**(上の 3 の `command` に `--from-pre-registration` と ID を足す。**運営の組織の ID も環境変数で渡す**。事前登録は運営の組織の持ち物):

```bash
--overrides "$(jq -n --arg k "$KEY" --arg p "<事前登録の ID>" --arg s "<運営の組織の ID>" \
  '{containerOverrides:[{name:"migrate",
    command:["dist/cli.js","create-tenant",$k,"--from-pre-registration",$p],
    environment:[{name:"SUPPORT_TENANT_ID",value:$s}]}]}')"
```

   ログに `{"mode":"plan",…,"preRegistrationId":"…"}`。落ちたとき:

| ログ | どうするか |
|---|---|
| `確認済みの事前登録がありません: …` | 確認待ち(本人が確認のメールを開いていない)・もう組織にした・期限で消えた・ID の打ち間違い。確認待ちなら本人に確認のメールを開いてもらう(組織にはできない決まり。設計書 0025 の U-4) |
| `申込書と事前登録で値が違います: name, admin.email` | 申込書と事前登録が別の会社・別の人。営業・CS に、どちらが正しいかを本人に確かめてもらう(値はログに出ない) |
| `事前登録は運営の組織の持ち物です。SUPPORT_TENANT_ID …` | 環境変数を渡し忘れた |

4. **本当に作る**(上の 4 に `--from-pre-registration` と ID を足す)。ログに `{"mode":"created",…,"preRegistrationId":"…"}`。
   - `組織は作りました(…)が、事前登録 … はほかの組織につながっていました` と出たら: 組織はできている(`tenantId` を控える)。同じ登録から2つ目の組織を作ろうとしていないかを2人で確かめる(作業の記録で、同じ事前登録の ID の組織が無いか)。登録のつなぎ先は直さない(先につないだ組織が正)。
   - 利用規約への同意は、いつもどおり最初の管理者がログインのときに取る(事前登録の同意は案内と招待まで)。

## 手元・プレビューで試す

置き場(`APPLICATIONS_BUCKET`)が無い使い捨ての環境(local / test / preview)では、引数を手元のファイルの道すじとして読む:

```bash
pnpm --filter @app/api exec tsx --env-file-if-exists=.env src/cli.ts create-tenant ./application.json
```

## 運営の組織も、これで作れる

環境ごとに1回の「運営(サポート)」の組織([support-access.md](support-access.md) の 1)も、`"mfaRequired": true` にしてこのコマンドで作れる(そのときは `SUPPORT_TENANT_ID` はまだ無いので渡さない)。2人目からの社員は、最初の社員が画面「設定」→「招待」から招く。
