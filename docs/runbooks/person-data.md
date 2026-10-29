# 手順書: 利用者1人から「私のデータを見せて・消して」と求められたら

> 仕様は [specs/0048-person-data.md](../specs/0048-person-data.md)・[ADR 0059](../adr/0059-person-data-dry-run-first.md)(開示と試し)・[specs/0089-person-erase.md](../specs/0089-person-erase.md)・[ADR 0088](../adr/0088-person-erase-same-list-as-dry-run.md)(消す)。分担の既定は [legal/data-processing.md](../legal/data-processing.md) の 5-2。
> **自社は委託先**。本人に答えるのはお客さん(委託元)で、運営はお客さんの管理者の**書面の指示**で手伝う。
> 運営のコマンドは、既定は**数えるだけ**(何も変えない)。消すのは `--execute --confirm-rows <数>` を付けたときだけ(5)。名前・メールの値は運営の手を通さない。

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
- `lines` … その人を指す行がある表と列だけ。`action` は消すときの扱い(匿名化・削除・残す)。5 のコマンドはこのとおりに消す。

## 3. 結果を知らせる(運営 → お客さんの管理者)

指示を受けてから **5営業日以内**に、`lines` の表(表・件数・扱い)をお客さんの管理者に送る。値は入っていないので、そのまま送ってよい。

## 4. 開示(お客さんの管理者 → 本人)

- お客さんの管理者が、書き出しの JSON から**その人の分**(`users` の行と、その人の ID が入っている行)を抜き出して本人に渡す。運営は抜き出さない・値を見ない。
- 書き出しに入らない物(ログ・バックアップ・Cognito のパスワードのハッシュ)は、[guides/data-retention.md](../guides/data-retention.md) の 1 の表の言葉で説明する(値は運営も読まない・読めない)。

## 5. 削除(運営のコマンド。2人で)

コマンドは試しと同じ一覧で、扱い(`action`)のとおりに消す・匿名化する(扱いは設計書 0048 の U-2・[仕様 0089](../specs/0089-person-erase.md))。**戻せない**ので、お客さんの管理者と 2 の試しの結果(表・件数・扱い)を確かめてから、2人で(1人が打ち、1人が試しの結果と読み合わせる):

1. **Cognito を先に**: `cognitoSub` が出ていて、**`otherMemberships` が 0 のときだけ**、その利用者を Cognito から消す([offboarding.md](offboarding.md) の 3 と同じ `admin-delete-user`)。1以上なら、その人はほかの組織にも所属しているので、Cognito は消さずにこの組織の所属だけを扱う(docs/specs/0055-multi-org-membership.md)。消すコマンドが DB の結びつき(`external_id`)を消すので、後からは sub が引けない(出力には消す前の sub が出る)。
2. 試しの `totals` の **`anonymize` と `delete` の合計**を `--confirm-rows` に渡して流す(試しの後で行が変わっていれば、何も変えずに止まる。流し直して数を確かめ直す):

```bash
aws ecs run-task --cluster $CLUSTER --task-definition $CLUSTER-migrate --launch-type FARGATE   --network-configuration "$NETWORK"   --overrides '{"containerOverrides":[{"name":"migrate","command":["dist/cli.js","person-data","<組織の ID>","<利用者の ID>","--execute","--confirm-rows","<数>"]}]}'
```

ロググループに `{"mode":"erased",…}` の1行が出る(形は試しと同じ・消す前の数。値は出ない)。

- 何をするか: 本人の行(`organizations.users`)は名前を「削除した利用者」・メールを `deleted-<ID>@invalid` に置き換え、Cognito と情シスの道具との結びつきを切り、止める(ログインできない・人数に数えない)。招待のメール(いまのメールと、変える前のメールの物)も置き換える。本人だけの記録(お知らせ・メールの変更・利用の記録・聞き終えた印・送信待ち)は消す。
- **残す物**: 監査ログ(`actor_id`)・規約への同意(`legal.consents`)・作った人や許可した人の ID。値は入っていない。
- 1つのトランザクションで流し、終わる前に数え直す。消し残しがあれば全部取り消して止まる(表と列の名前が出る。一覧と消し方がずれているので、開発の人に渡す)。
- その組織の監査ログに「本人の求めで、その人のデータを消した」が件数つきで残る(お客さんの管理者が画面で見られる)。
- 運営の組織(`SUPPORT_TENANT_ID`)の人(社員)は、このコマンドでは消さない(止まる)。
- 流した後にもう一度 2 の試しを流し、`delete` の行が0になったのを確かめる。
- 消した人は、管理者の「組織の人」に「削除した利用者」として止めたまま残る(ほかの行が指しているため)。管理者が「戻す」を押しても、ログインはできない(人数に数えられるだけ)ので、押さないように伝える。
- 消した後も残る所(バックアップ最長 365日・ログ 30〜90日)を、お客さんの管理者に知らせる([guides/data-retention.md](../guides/data-retention.md) の 1)。

## 6. 終わったら

- [ ] 作業の記録のスレッドに、受けた日・試しの日・知らせた日・(消したなら)消した日を、組織の ID・利用者の ID だけで書く
- [ ] 書面の指示を、契約の管理の置き場(リポジトリの外)に残す
