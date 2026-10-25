# お客さんに出す取り決めの型(申込書・SLA・個人データの取り扱い)

> ⚠️ **ここには文面(法律の文)を書かない。** 項目と、キットの作りから決まる値・その根拠・使う人が決めることだけを並べる。お客さんに出す文面は、**専門家(弁護士など)に確かめてから**作る。
> 決めた理由は [ADR 0041](../adr/0041-contract-templates-fixed-and-negotiable.md)、仕様は [specs/0028](../specs/0028-contract-templates.md)、設計(と既定の値の未確定事項)は [designs/0028](../designs/0028-contract-templates.md)。
> 利用規約・プライバシーポリシー(全員に同じ物)は [guides/legal-documents.md](../guides/legal-documents.md)。ここはお客さん(会社)ごとに取り交わす物。

## 1. 型の一覧

| 型 | いつ要るか | ファイル |
|---|---|---|
| 見積書 | 申し込みの前に、プラン・人数・価格表の版をそろえて出すとき | [quote.md](quote.md) |
| 申込書(注文書) | 会社として申し込んでもらうとき(社員が権限なく申し込むのを防ぐ) | [order-form.md](order-form.md) |
| SLA(稼働の約束) | 「稼働率は? 障害のときの連絡は?」と聞かれたとき・大口の契約 | [sla.md](sla.md) |
| 個人データの取り扱いの取り決め | お客さんから見て、自社が個人データを預かる**委託先**になるとき | [data-processing.md](data-processing.md) |

どの型も同じ形: **項目 / キットの既定 / 根拠(どのファイル) / 使う人が決めること**。既定の値のうち事業や契約で変わる物は、設計書 0028 の未確定事項にある(状態は「導入時に決める」。`pnpm decisions --adopt` で出るので、自分の契約に合わせて決める)。

## 2. キットの作りから、もう決まっている項目

営業が聞かれる「仕組みの事実」。**値はここに写さず、根拠のファイルが正**(仕組みを変えたら根拠のファイルと、この表を同じ PR で直す)。下の値は 2026-10-25 の Terraform の既定。

| 項目 | キットの既定 | 根拠 |
|---|---|---|
| データの置き場所 | 日本(東京)。外形監視のアラームと証明書だけ米国(個人データは置かない) | [compliance/vendors.md](../compliance/vendors.md) |
| 再委託先(外の会社) | AWS(委託・個人データあり)。GitHub・Sentry・Slack・Anthropic は ID と集計だけ(個人データは渡さない) | [compliance/vendors.md](../compliance/vendors.md)(`pnpm vendors --write` で作る)・[compliance/ai-data.md](../compliance/ai-data.md) |
| 会社どうしの分け方 | 全社が同じ表+行ごとの守り(RLS)+2社のテスト。専用の DB・専用の鍵は上位の選択肢 | [security.md](../security.md) の T-1〜T-9・V-1・[ADR 0001](../adr/0001-shared-tables-with-rls.md) |
| 社員がお客さんのデータを見る道 | 代理ログインだけ(お客さんの管理者が期限つきで許可・見るだけ・最長1時間・お客さんの監査ログに残る) | [security.md](../security.md) の T-7・[runbooks/support-access.md](../runbooks/support-access.md) |
| 操作の記録 | 書き込みは全部、監査ログに残る。お客さんの管理者が画面で見られる | [specs/0003](../specs/0003-audit-log.md)・[security.md](../security.md) の AZ-6 |
| 暗号化 | 通信は TLS だけ。保存は KMS の鍵(DB・バックアップ)。要配慮は組織ごとのデータ鍵で列ごと | [compliance/soa.md](../compliance/soa.md)・[ADR 0029](../adr/0029-sensitive-data-tier1.md) |
| バックアップ | 時点復元は prod **14日**(秒単位・最新は5分ほど前まで)。消せない保管庫に毎日 **35日**・毎月 **365日** | [runbooks/db-restore.md](../runbooks/db-restore.md)・[ADR 0012](../adr/0012-backup-vault-and-restore-drills.md) |
| 戻せる時点・戻す早さ | 戻せるのは5分ほど前まで。1社分だけ戻せる(ほかの会社に触れない)。一時の DB ができるまで 15〜30分(訓練で直す目安。**約束の値にはしない**) | [runbooks/db-restore.md](../runbooks/db-restore.md) の 3・5 |
| 解約したとき | 削除のコマンドで DB とログインの情報をすぐ消す。バックアップは期間(最長 365日)が過ぎて自動で消える。その間に戻すことはしない | [runbooks/offboarding.md](../runbooks/offboarding.md)・[guides/data-retention.md](../guides/data-retention.md) |
| 持って出る(書き出し) | 管理者が画面から、組織の全部のデータを書き出せる | [specs/0005](../specs/0005-offboarding.md)・[specs/0018](../specs/0018-export-stream.md) |
| ログの保存 | アプリ 90日・DB とメールと WAF 30日・Sentry 90日。名前・メールアドレス・本文は出さない(許可リスト) | [guides/data-retention.md](../guides/data-retention.md)・[ADR 0019](../adr/0019-log-allowlist.md) |
| 見張り | 外から30秒ごと(東京・シンガポール・オレゴン)。ほとんどの地点から2分続けて開けないと Slack に鳴る | [guides/monitoring.md](../guides/monitoring.md)・`infra/terraform/modules/uptime` |
| 障害の重さと連絡 | S1 は30分以内に1報・以後1時間ごと / S2 は1時間以内 / S3 は知らせない。S1・S2 は5営業日以内に振り返り | [runbooks/incident.md](../runbooks/incident.md) の 1・4・6 |
| 個人データの事故 | お客さん(委託元)に、知ってから 3〜5日のうちに知らせる。報告と本人への通知はお客さんと一緒に | [runbooks/personal-data-breach.md](../runbooks/personal-data-breach.md) の 4 |
| 止めずに出す | 出し直しは blue/green(止まらない)。DB の変更は止めずに段階で(拡張 → 縮小)。DB の入れ替え・大きな版上げは止まることがある | [runbooks/deploy-rollback.md](../runbooks/deploy-rollback.md)・`.claude/skills/db-migration` |
| 安全管理措置 | 附属書 A の管理策ごとの実施(適用宣言書)と、セキュリティの決まり | [compliance/soa.md](../compliance/soa.md)・[security.md](../security.md) |
| AI に渡すデータ | 本番の個人データは渡さない。ID と集計まで。要配慮は一切 | [security.md](../security.md) の AI-6・[compliance/ai-data.md](../compliance/ai-data.md) |

## 3. 変えてよい条件と、変えない条件

大企業から個別の契約書・赤字の修正が来たときに、**先にこの3つに分けてから**交渉する。

| 分け | 何か | 例 | 頼まれたら |
|---|---|---|---|
| **変えない**(キットの作りで決まる) | 仕組みを変えないと守れない物。契約に書くと、守れない約束になる | バックアップの保存の期間(prod の保管庫は**ロックで誰にも縮められない**)・解約後にバックアップから消える日(最長 365日より早くは消せない)・データの置き場所(東京)・社員が見る道は代理ログインだけ・AI に個人データを渡さない | 断る。理由は根拠のファイルを示す。どうしても要るなら「仕組みを変える」の段で、費用と期間を見積もってから |
| **仕組みを変えれば変えられる**(上位の選択肢) | キットに手順書や次の一歩があり、お金と手間で応えられる物 | 専用の DB・会社ごとの鍵(鍵を消せばバックアップの中も読めなくなる。[security.md](../security.md) の T-5・[runbooks/sensitive-data-tiers.md](../runbooks/sensitive-data-tiers.md))・別リージョンへのバックアップ([ADR 0012](../adr/0012-backup-vault-and-restore-drills.md) の見直す合図)・夜間の当番 | 上位のプラン・個別の見積もりにする。仕組みを入れるまで契約に書かない |
| **契約だけで変えられる** | 仕組みに関係しない数字と手続き | 稼働率の線・補償の段・連絡の時間・契約の期間・自動更新・解約の申し出の期限・支払い・解約後に消すまでの日数(30日 → 60日 など、長くする方) | 責任者が決める。キットの既定から変えたら、この会社の分として記録する(下の 4) |

- 迷ったら「変えない」に倒す(守れない約束を書くより、断る方が安い)。
- 「契約だけで変えられる」の中でも、**連絡の時間を縮める**(夜中も30分など)は当番の体制が要るので、実は「仕組みを変える」に当たる。

## 4. 会社ごとに変えた物の記録

キットの既定から変えた条件は、**その会社の契約書の側**(リポジトリの外。契約の管理の置き場)に残す。リポジトリにお客さんの名前・金額を書かない。リポジトリに残すのは「既定から変えられる物の一覧」(この型)だけ。

## 5. してはいけない

- 型に、お客さんの名前・金額・契約書の写しを書く(リポジトリは多くの人とAIが読む)
- 根拠のファイルを見ずに、値だけを営業の資料に写す(仕組みを変えたときに食い違う)
- 専門家に確かめていない文面を、お客さんに出す
