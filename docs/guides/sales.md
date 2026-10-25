# 営業の道具(デモ・見積から申込・稟議の資料)

> 商談でデモを見せ、見積を出し、申込書を受け、稟議の資料を渡す、を毎回作らずに回す。仕様は [specs/0053](../specs/0053-sales-kit.md)・設計は [designs/0053](../designs/0053-sales-kit.md)・判断は [ADR 0064](../adr/0064-sales-kit-demo-on-stg.md)。
> **本番の個人データは使わない。** デモは stg の偽のデータだけ。お客さんの名前・金額・商談の記録はリポジトリに書かない(CRM や契約の管理の置き場へ。道具の扱いは [sales-tools.md](sales-tools.md))。

## 1. デモ用の組織(stg・デモの前に戻す)

1. **一度だけ: stg にデモの組織を作る**。申し込みの JSON(`name` は「デモ 株式会社」など・`admin.email` は営業の会社のアドレス・`plan` は見せたいプラン)で `create-tenant` を流す([runbooks/tenant-provisioning.md](../runbooks/tenant-provisioning.md)。stg で)。管理者が招待から登録し、ほかのデモのアカウント(メンバー・閲覧者)を画面「招待」で足す。
2. 見せる機能を入れる(`feature-flag <デモの組織の ID> <機能> on --execute`。[runbooks/feature-flags.md](../runbooks/feature-flags.md))。
3. GitHub の変数 `DEMO_TENANT_ID` にデモの組織の ID を入れる(Settings → Secrets and variables → Actions → Variables。人が入れる)。
4. **デモの前に**(商談の前の日か、始まる 10分前までに)、Actions → Demo reset → Run workflow を押す。`demo-reset.yml` が、stg の移行のタスクで `demo-reset --execute` を流す(数分。終わると要約に「戻しました」)。定期では流れないので、デモの無い日は何も動かない。戻すのは**計画・タスク・招待・利用の記録など**(組織の行のある表のうち、下の「残す物」のほか全部)。**組織・人(ログイン)・契約のプラン・入れた機能・同意・監査ログは残す**。そのあと決まったデモのデータ(`apps/api/src/demo/reset.ts` の `DEMO_DATA`)を入れ直す。
   - デモのデータは自分のプロダクトに合わせて `DEMO_DATA` を直す(偽の題名だけ。本物のお客さんのデータを写さない)。
   - 失敗したら(赤くなったら)CloudWatch Logs の `migrate` を見る。手元で試すなら `APP_ENV=local DEMO_TENANT_ID=<ID> node dist/cli.js demo-reset`(試し)→ `--execute`。
   - コマンドは、`APP_ENV` がはっきり stg・手元・テスト・プレビューで、`DEMO_TENANT_ID` があるときだけ動く(本番では止まる。運営の組織も指せない)。
5. デモの中で相手が足した人(招待を受けて登録した人)は残る。消すなら [runbooks/person-data.md](../runbooks/person-data.md) の手順で。

## 2. 見積から申込まで

| 段 | 何を | 型・つなぎ |
|---|---|---|
| 見積 | プラン・人数・どの版の価格表か・有効期限・据え置きの有無 | 見積書の型 [legal/quote.md](../legal/quote.md)。プランと価格表の版は `@app/shared` の `PLANS`・`PRICE_LISTS`(金額は会計ソフト) |
| 申込 | 見積と同じプラン・人数・価格表の版を、会社として申し込んでもらう | 申込書の型 [legal/order-form.md](../legal/order-form.md)(申し込む人と承認した人を別の欄に) |
| 開通 | 申込書から申し込みの JSON(`plan`・`seats`・`priceList`・`priceLockedUntil`)を作り、組織を作る | [runbooks/tenant-provisioning.md](../runbooks/tenant-provisioning.md)・[runbooks/plans.md](../runbooks/plans.md) |

- **見積・申込書・JSON で、プランの名前と価格表の版をそろえる**(違うと、値上げのときに据え置きの対象が分からなくなる)。
- 見積の有効期限を過ぎた申込書が来たら、そのときの価格表の版で出し直す。
- 値引き・個別の条件は、その会社の契約の側に残す(リポジトリに書かない。[legal/README.md](../legal/README.md) の 4)。

## 3. 稟議の資料の束

大企業・病院の稟議には「仕組みの事実・SLA・個人データの取り扱い・委託先・セキュリティの答え」を1つにして渡す。

1. 型を1つにまとめる(リポジトリの外に書く):

   ```bash
   pnpm sales:pack --out ~/Desktop/ringi-pack.md
   ```

   [legal/README.md](../legal/README.md) の 2(仕組みの事実)・[legal/sla.md](../legal/sla.md)・[legal/data-processing.md](../legal/data-processing.md)・[compliance/vendors.md](../compliance/vendors.md) を順に並べ、頭に「出す前に埋める所」(`<…>`・`YYYY`・`◯`・「仮の既定」)の一覧を付ける。キットの中へのリンクは文だけになる。
2. セキュリティの質問票が届いていれば、Claude Code で `/security-questionnaire` を流し、根拠つきの下書き(リポジトリの外)を束の後ろに付ける。
3. 埋める所を埋め、その会社と取り決めた条件(SLA を付けるか・消すまでの日数など)を書き足す。**文面は専門家(弁護士など)に確かめてから出す**。
4. 出した版(日付と、束の頭のキットの版)を、その会社の契約の側に残す。仕組みが変わったら(Terraform の値・手順書)、次の束は作り直す。
