# 手順書: 利用者1人から「私のデータを見せて・消して」と求められたら

> 仕様は [specs/0048-person-data.md](../specs/0048-person-data.md)・[ADR 0059](../adr/0059-person-data-dry-run-first.md)。分担の既定は [legal/data-processing.md](../legal/data-processing.md) の 5-2。
> **自社は委託先**。本人に答えるのはお客さん(委託元)で、運営はお客さんの管理者の**書面の指示**で手伝う。
> 運営のコマンドは**数えるだけ**(何も変えない)。名前・メールの値は運営の手を通さない。

## 1. 求めを受ける(お客さんの管理者)

- 本人から運営に直接来たら: 「ご所属の会社の管理者に頼んでください」と返す(本人を確かめられるのはお客さん)。会社の名前が分かれば、その会社の管理者にも知らせる。**どのデータがあるかは本人に答えない**。
- お客さんの管理者は、本人を確かめてから(社員か・辞めた人か・本人のメールか)、運営に**書面で**指示を出す。書いてもらう物:
  - 組織の ID(運営は代理ログインの画面や作業の記録で分かる)
  - **利用者の ID**: 管理者が画面「設定」→「データの書き出し」で受け取った JSON の `users` から、その人の `id` を探す(メールで探せる)
  - 求めの種類(開示・削除)
- 指示の受け取りは作業の記録のスレッドに残す(名前・メールは書かない。組織の ID・利用者の ID・受けた日だけ)。

## 2. 試し(運営)

ECS の API のイメージで、移行と同じ接続(表の持ち主)で流す。引数は ID だけ(名前・メールを渡さない):

```bash
aws ecs run-task --cluster $CLUSTER --task-definition $CLUSTER-migrate --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides '{"containerOverrides":[{"name":"migrate","command":["dist/cli.js","person-data","<組織の ID>","<利用者の ID>"]}]}'
```

ロググループ `/ecs/<名前>-prod` の `migrate/…` に1行出る(値は出ない):

```json
{"mode":"plan","tenantId":"…","userId":"…","found":true,"cognitoSub":"…",
 "lines":[{"table":"organizations.users","column":"id","action":"anonymize","rows":1,"why":"…"},
          {"table":"platform.audit_events","column":"actor_id","action":"keep","rows":42,"why":"…"},…],
 "totals":{"anonymize":2,"delete":5,"keep":45}}
```

- `found: false` … その組織にその利用者はいない(ID の写し間違い。他社にいるかは調べない・答えない)。
- `lines` … その人を指す行がある表と列だけ。`action` は消すときの扱いの案(匿名化・削除・残す)。

## 3. 結果を知らせる(運営 → お客さんの管理者)

指示を受けてから **5営業日以内**に、`lines` の表(表・件数・扱い)をお客さんの管理者に送る。値は入っていないので、そのまま送ってよい。

## 4. 開示(お客さんの管理者 → 本人)

- お客さんの管理者が、書き出しの JSON から**その人の分**(`users` の行と、その人の ID が入っている行)を抜き出して本人に渡す。運営は抜き出さない・値を見ない。
- 書き出しに入らない物(ログ・バックアップ・Cognito のパスワードのハッシュ)は、[guides/data-retention.md](../guides/data-retention.md) の 1 の表の言葉で説明する(値は運営も読まない・読めない)。

## 5. 削除(当面は手作業。2人で)

消すコマンドは次の一歩(扱いの案は設計書 0048 の U-2。承認されたら作る)。それまでは、お客さんの管理者と試しの結果を確かめてから、表の持ち主で手で(2人で。1人が打ち、1人が試しの結果と読み合わせる):

```sql
BEGIN;
SELECT set_config('app.tenant_id', '<組織の ID>', true);
-- 匿名化(本人の行。ほかの行が指しているので消さない)
UPDATE organizations.users
   SET name = '削除した利用者', email = 'deleted-' || id || '@invalid', external_id = NULL
 WHERE tenant_id = '<組織の ID>' AND id = '<利用者の ID>';
-- 本人だけの記録を消す(試しで rows が出た表だけ)
DELETE FROM organizations.email_changes WHERE tenant_id = '<組織の ID>' AND user_id = '<利用者の ID>';
DELETE FROM legal.notices          WHERE tenant_id = '<組織の ID>' AND user_id = '<利用者の ID>';
DELETE FROM platform.feature_usage WHERE tenant_id = '<組織の ID>' AND user_id = '<利用者の ID>';
COMMIT;
```

- 招待のメール(`organizations.invitations.email`)・送信待ち(`platform.outbox`)も試しで出たら、同じく匿名化・削除する(SQL は試しの `table` と `column` を見て書く)。
- **残す物**: 監査ログ(`actor_id`)・規約への同意(`legal.consents`)・作った人や許可した人の ID。値は入っていない。
- 流した後にもう一度 2 の試しを流し、`delete` の行が0になったのを確かめる。
- Cognito: `cognitoSub` が出ていて、**`otherMemberships` が 0 のときだけ**、その利用者を Cognito から消す([offboarding.md](offboarding.md) の 3 と同じ `admin-delete-user`)。1以上なら、その人はほかの組織にも所属しているので、この組織の所属だけを扱う(docs/specs/0055-multi-org-membership.md)。
- 消した後も残る所(バックアップ最長 365日・ログ 30〜90日)を、お客さんの管理者に知らせる([guides/data-retention.md](../guides/data-retention.md) の 1)。

## 6. 終わったら

- [ ] 作業の記録のスレッドに、受けた日・試しの日・知らせた日・(消したなら)消した日を、組織の ID・利用者の ID だけで書く
- [ ] 書面の指示を、契約の管理の置き場(リポジトリの外)に残す
