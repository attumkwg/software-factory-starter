# 公開の LP の事前登録: 数える・消す・組織にする

> 仕様: [specs/0025](../specs/0025-public-landing-page.md)・領域: [domain/growth](../domain/growth/README.md)・決まり: [guides/landing-page.md](../guides/landing-page.md)。
> `pre-registrations-report` は**読むだけ**。`pre-registrations-purge --execute`・`pre-registrations-delete --execute` は**本番の DB から消す操作**(戻せない)。どれも人が打つ。AI は打たない。
> **メールアドレス・会社名をチャット・Issue・PR・AI に貼らない**(出力は数と率だけ。docs/security.md の AI-6)。

ECS の API のイメージで、移行と同じ接続(表の持ち主)・`SUPPORT_TENANT_ID`(運営の組織)を渡して流す(`usage-report` と同じ)。

## 数える(どの届け方から来たか)

```bash
node dist/cli.js pre-registrations-report --from 2026-11-01 --to 2026-11-30
```

`{"mode":"report","from":"2026-11-01","to":"2026-11-30","total":{…},"sources":[{"utmSource":"koumuten-kai","utmMedium":"email","utmCampaign":"launch-2026-11","views":420,"registrations":21,"confirmations":17,"registrationRate":5,"confirmationRate":81},…]}`

- 期間は日本時間の日付(両端を含む)。省くと今日までの28日。
- `views` は公開のページが開かれた数(Cookie を使わない目安。広告の管理画面の数とは合わない)。`registrationRate` = 登録 ÷ 見た数(%)・`confirmationRate` = 確認 ÷ 登録(%)。
- 賭けの小石や全体の計画には、来た所ごとの**率**で書く。

## 期限の過ぎた登録を消す(週1回)

確認待ちは登録から7日・確認済みは登録から1年・組織にしてから30日・日ごとの数は3年(`@app/shared` の `PRE_REGISTRATION_RETENTION_DAYS`。設計書 0025 の U-3)。

1. 試し(数えるだけ):
   ```bash
   node dist/cli.js pre-registrations-purge
   ```
   `{"mode":"plan","today":"2026-11-08","preRegistrations":12,"dailyCounts":0}`
2. 件数がおかしくないか(急に多い・少ない)を見て、消す:
   ```bash
   node dist/cli.js pre-registrations-purge --execute
   ```
   運営の組織の監査ログに `pre_registration.purged`(件数だけ)が残る。
3. 確認待ちのリンクは7日で使えなくなる(消すまでの間も、案内は送らない・組織にできない)。

## 本人から「消して」と言われた

1. 問い合わせのメールアドレスを、**手元の端末で**標準入力から入れる(コマンドの引数に書かない = 端末の履歴に残さない):
   ```bash
   node dist/cli.js pre-registrations-delete
   ```
   アドレスを1行入れると `{"mode":"plan","found":1}`。
2. 見つかったら、もう一度 `--execute` を付けて流し、同じアドレスを入れる:
   ```bash
   node dist/cli.js pre-registrations-delete --execute
   ```
   `{"mode":"deleted","found":1}`。運営の組織の監査ログに `pre_registration.deleted`(登録の ID だけ)が残る。
3. 本人に「消しました」と返す。バックアップの中には、バックアップの保存期間だけ残る([guides/data-retention.md](../guides/data-retention.md))。

## 確認済みの登録を、本物の組織にする

組織を作るコマンド `create-tenant` に `--from-pre-registration <事前登録の ID>` を足して流す。手順は [tenant-provisioning.md](tenant-provisioning.md) の「事前登録から」。つなぐ形:

- `loadPreRegistrationForTenant`(`apps/api/src/domains/growth`)が、確認済みの登録から組織の名前の案と最初の管理者のメールアドレスを返す(確認待ち・組織にした登録は返さない)。
- 組織を作った後に `markPreRegistrationConverted` で「組織にした」にする(作った組織の ID が残る・30日で消える。同じ組織で2回呼んでもよい)。
- 利用規約への同意は、招待された管理者が登録の画面で取る(事前登録の同意は案内と招待まで)。
