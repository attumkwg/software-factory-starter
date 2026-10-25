# 仕様: 委託先の台帳と照らし合わせ・AI に渡すデータの決まり・管理操作の記録(CloudTrail)

> 状態: 承認済み(承認した人: @attumkwg 2026-10-25。U-1・U-2 はキットの既定として承認し、導入時に決める)
> 2026-10-25 の変更: 管理操作の記録のロックの既定は prod も governance(下の「prod は compliance」は導入時に選べる物になった。設計書 0017 の U-2・作り直しの記録)
> 設計: [docs/designs/0017-vendors-ai-data-audit-trail.md](../designs/0017-vendors-ai-data-audit-trail.md)・ADR: [0030](../adr/0030-vendor-ledger-ai-data-and-audit-trail.md)

## なぜ作るか

- P マーク・ISMS の準備で最初に求められる「**個人データをどこに預けているか**(委託先の一覧と監督)」が無かった。AWS・GitHub・Sentry・AI の会社に何を渡しているかが、コードと Terraform を読まないと分からない。AI が SDK や AWS のサービスを足しても、誰も気づかない。
- AI に本番のログを読ませる手順(障害の一次調査など)はあるのに、「**何なら渡してよいか**」の決まりが無かった。AI の会社(米国)に個人データを渡すと、委託先の監督と越境の両方の話になる。
- AWS の管理操作(誰が鍵を作った・誰がバケットを公開にした)の記録が、AWS の既定(90日・消せる)のままだった。事故の後に「誰が何をしたか」を出せず、認証の審査でも記録の改ざん防止を求められる。

## 受け入れ条件

### 委託先の台帳

- [ ] `docs/compliance/vendors.yaml` に、使っている外の会社が1社1件である。各社に: 預け方(委託 / 第三者提供 / 渡さない)・所在国・渡すデータの区分(`classification.ts` の public / internal / personal / sensitive)・契約(DPA)の状態とリンク・第三者の認証・使うのをやめたとき / お客さんが解約したときの消え方・確かめた日
- [ ] キットが今使っている物(AWS・GitHub・Sentry・Anthropic・Slack・Renovate・Docker・HashiCorp・CI の公開の道具)が埋まっている。AWS は使っているサービスごとに、渡す区分がある
- [ ] 人が読む一覧 `docs/compliance/vendors.md` が台帳から作られ(`pnpm vendors --write`)、古ければ CI が落ちる

### CI の照らし合わせ

- [ ] package.json に外のサービスの SDK(`@sentry/*`・`stripe` など)を足して、台帳に無ければ CI(`pnpm vendors`)が落ちる
- [ ] Terraform に、台帳の AWS のどのサービスにも無い資源の種類(例: `aws_sqs_queue`)を足すと CI が落ちる。台帳に無い提供者(例: `hashicorp/google`)も落ちる
- [ ] ワークフローに、台帳に無い Actions(`uses: owner/repo@…`)を足すと CI が落ちる
- [ ] 台帳の区分が `classification.ts` に無い言葉なら CI が落ちる。使うのをやめた会社(`status: ended`)の物を使っていても落ちる
- [ ] 台帳を変える PR は危険度「高」(人の確認・CODEOWNERS)

### AI に渡すデータの決まり

- [ ] `docs/security.md` に決まり AI-6「本番の個人データを AI に渡さない。渡すのは ID と集計まで。要配慮は一切渡さない」がある
- [ ] `docs/compliance/ai-data.md` に、出どころ(ログ・Sentry・DB・監査ログ・CloudTrail・問い合わせ・画面)ごとの渡してよい物・渡さない物・渡し方・渡してしまったときがある
- [ ] 台帳で AI の会社(`ai: true`)に personal か sensitive を書くと CI が落ちる
- [ ] AI にログを読ませる箇所(`incident.md`・`sentry.md`・`CLAUDE.md`・不具合の報告のスキル)が、この決まりを指す
- [ ] 越境(Sentry・Anthropic などが米国)の扱いは、専門家に確かめる問いとして設計書の未確定事項にある

### 管理操作の記録(CloudTrail)

- [ ] stg・prod のアカウントに、全部のリージョンの管理の出来事(読みと書き)を取るトレイルがある。記録は KMS で暗号化した S3 に入り、Object Lock で保存の期間(400日)は消せない(prod は compliance・stg は governance)。ファイルの検証(ダイジェスト)が有効
- [ ] 同じ記録が CloudWatch Logs にも流れ、ロググループの名前・ARN が Terraform の出力にある(ほかのアラームをここに繋げる)
- [ ] root のアカウントの利用と、記録を止める・変える操作で、アラームが Slack に来る
- [ ] Organizations が Terraform に無いことを確かめ、いまはアカウントのトレイルにする。組織のトレイルへの移り方は手順書 `docs/runbooks/audit-trail.md` にある
- [ ] GitHub の plan の役割から、CloudTrail の記録の中身は読めない
- [ ] `docs/compliance/README.md` が、認証の準備の入口になる(台帳・AI の決まり・記録の置き場の地図)

## 権限の表に足す行

該当なし(API を足さない)。

## 悪用のされ方(STRIDE で1行ずつ)

| 観点 | どう悪用されうるか | どう防ぐか(テスト / ルール) |
|---|---|---|
| なりすまし | 漏れた鍵で AWS を操作し、社員のふりをする | CloudTrail に鍵の ID・IP が残る。GuardDuty が漏れた鍵の利用を見つける(既存) |
| 改ざん | AI が台帳の区分を書き換えて、個人データを AI の会社に渡す道を通す / 記録のファイルを書き換える | 台帳は危険度「高」(人の確認)。AI の会社に personal を書くと CI が落ちる / Object Lock とファイルの検証(`validate-logs`) |
| 否認 | 「その操作は自分ではない」 | 管理操作の記録を消せない S3 に400日。誰が(IAM の名前)・どこから(IP)・いつ |
| 情報漏えい | 障害の調査で本番のログ・画面を AI に貼り、個人データが米国の会社に渡る | AI-6 と ai-data.md(貼る前に人が見る・項目を決めたクエリ)。AI は本番に入れない(AI-1) |
| 妨害 | 記録を止めてから悪さをする / 記録を消して痕跡を消す | 止める・変える操作でアラーム。prod の記録は root でも消せない |
| 権限昇格 | PR から引ける plan の役割で、記録(社員の名前・IP)を読む | plan の役割に `cloudtrail:LookupEvents` などの明示の拒否。ロググループと S3 の物はもとから読めない |

## やらないこと

- Organizations・ログ専用のアカウントを Terraform で作ること(組織のトレイルは手順書で、管理アカウントを持ってから)
- データの出来事(S3 の物の読み書きなど)を取ること(費用。要るなら対象を絞って足す)
- 委託先と実際に契約(DPA)を結ぶこと・プライバシーポリシーの文言(使う人と専門家がやる)
- コードの中の `fetch` で直接呼ぶ外の API を見つけること(SDK の名前・Terraform・Actions だけを照らす)
- 点検の台帳(`docs/checkup/todo.yaml`)に「委託先の見直し」の項目を足すこと(項目を足すのは `/checkup-refresh` の PR)

## 決めたこと

- キットの持ち主の方針(設計案「P マーク・ISMS の準備」の 🔴: 委託先の台帳・AI に渡すデータの決まり・CloudTrail の組織トレイル)を、この仕様の要求にした。
- AI に渡すのは「ID と集計まで・要配慮は一切」は持ち主が決めた決まり。越境の扱いと、prod の記録を消せなくする強さは、設計書の「未確定事項」で人に聞く。
