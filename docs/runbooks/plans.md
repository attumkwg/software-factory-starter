# 手順書: 組織の契約のプランを入れる・変える(人数・値上げと据え置き)

> 仕様は [specs/0047-plans.md](../specs/0047-plans.md)・[ADR 0058](../adr/0058-plans-table.md)。申込書の欄は [legal/order-form.md](../legal/order-form.md)。
> **本番の DB に書く操作**(`platform.tenant_plans` と監査ログに足す)。人が打つ。AI は打たない。2人で(CS が申込書を読み上げ、本番の AWS に入れる開発が打つ)。
> 金額はキットに無い(請求は会計ソフトで手で)。ここで合わせるのは「どのプラン・どの価格表の版・何人まで・据え置きはいつまで」。

## いつ

- 新しい組織: 開通のときに申し込みの JSON の `plan`・`seats`(と `priceList`・`priceLockedUntil`)で入る([tenant-provisioning.md](tenant-provisioning.md))。入れ忘れたら下の 2。
- 申込書の変更(プランを変える・人数を変える)を受けたとき。
- 値上げ(新しい価格表の版を足した PR がデプロイされた後)。
- 毎週の見直し(下の 4。点検の Issue で `plan-seats` として届く)。

## 1. いまの契約を見る

ECS の API のイメージで、移行と同じ接続(表の持ち主)を渡して流す(`feature-flag` と同じ):

```bash
node dist/cli.js plan <組織の ID>
```

`{"mode":"show","tenantId":"…","current":{"plan":"standard","priceList":"2026-10","seats":10,"priceLockedUntil":null,"effectiveOn":"2026-11-01"},"history":[…]}`。プランがまだ無ければ `"current":null`。

## 2. 入れる・変える(試し → 本番)

```bash
# 試し(何も足さない)
node dist/cli.js plan <組織の ID> --plan standard --seats 10
# 中身を申込書と突き合わせてから
node dist/cli.js plan <組織の ID> --plan standard --seats 10 --execute
```

| 項目 | 省いたとき |
|---|---|
| `--plan` | 要る(`@app/shared` の `PLANS` の id) |
| `--seats <数>` / `none` | いまのまま(初めてなら上限なし)。`none` で上限なし |
| `--price-list <版>` | 同じプランならいまのまま。プランを変えたら(初めても)その日の版 |
| `--locked-until <日>` / `none` | 同じプラン・同じ版ならいまのまま。それ以外は無し |
| `--effective-on <日>` | 組織の時間帯の今日。先の日付なら、その日から効く(予約) |

- **プランを変えると、据え置きは消える**(その日の価格表に移る)。旧価格のまま変えるなら `--price-list` と `--locked-until` を渡す。
- 人数だけ変えても、価格表と据え置きはそのまま。
- 成功すると `{"mode":"changed",…}`。その組織の監査ログに「仕組み(自動)が プランを変えた(standard・価格表 2026-10)」が残る。同じ中身なら `"mode":"unchanged"` で何も足さない。
- 人数の上限を超えても、お客さんの招待は止まらない(画面「招待」に契約の人数といまの人数が出る)。超えた組織は 4 の `plan-report` と毎週の点検(`plan-seats`)に出る。

## 3. 値上げ(据え置きつき)

1. 新しい価格表の版を `PRICE_LISTS` に**足す** PR(`effectiveFrom` は新価格の始まりの日。古い版は消さない)。規約の料金の条も変えるなら、同意し直しの版([legal-notice.md](legal-notice.md))。
2. デプロイの後、新しく契約する組織は新しい版になる。今の組織は旧版のまま。
3. 据え置きの期限を付ける組織(申込書・お知らせで約束した組織)に:
   ```bash
   node dist/cli.js plan <組織の ID> --plan standard --price-list 2026-10 --locked-until 2027-12-31 --execute
   ```
4. 期限が来た組織は 4 の `plan-report` に出る。お客さんに知らせてから、新しい版へ移す:
   ```bash
   node dist/cli.js plan <組織の ID> --plan standard --price-list 2027-04 --execute
   ```
   会計ソフトの請求の金額も同じ日から変える。

## 4. 毎週の見直し(読むだけ。点検の台帳の `plan-seats`)

```bash
node dist/cli.js plan-report --within-days 60
```

`{"mode":"report","today":"…","currentPriceList":"2027-04","counts":[{"plan":"standard","priceList":"2026-10","tenants":12},…],"withoutPlan":1,"priceLockEnding":[{"tenantId":"…","priceList":"2026-10","priceLockedUntil":"2027-05-31"}],"overSeats":[{"tenantId":"…","seats":10,"used":12}]}`

| 出た物 | どうするか |
|---|---|
| `withoutPlan` が0でない | 開通のときにプランを入れ忘れた組織。申込書を見て 2 |
| `priceLockEnding` | 旧価格の組織(据え置きの期限が近い・過ぎた・無い)。お客さんに知らせる → 期限の日に 3 の 4 |
| `overSeats` | 人数の上限を超えている(招待は止めない作り)。お客さんの管理者に知らせ、申込書の変更を頼むか、翌月の請求で合わせる(扱いは契約で決める) |

- 出るのは組織の ID と数だけ(名前は出ない)。運営の組織は数えない。

## 困ったとき

| こと | どうするか |
|---|---|
| `定義に無いプランです` / `定義に無い価格表です` | `PLANS`・`PRICE_LISTS` の名前を確かめる。足すなら PR が先 |
| 誤って変えた | 正しい中身で 2 をもう一度(行は足すだけ。前の行は残り、監査ログに2回残る) |
| お客さんが「人数を増やしたい」 | 申込書の変更を受けてから 2(`--seats`)。人数を超えていても招待は止まっていない |
