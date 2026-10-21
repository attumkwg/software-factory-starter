# 規約の変更のお知らせのメールを送る

> 仕様: [specs/0008](../specs/0008-legal-consent.md)・版を足す手順: [guides/legal-documents.md](../guides/legal-documents.md)。
> **本番の DB に書く操作**(お知らせの記録と送信待ちを足す)。人が打つ。AI は打たない。

## いつ

- 版を足した PR がマージされ、デプロイされ、**公開の日時(`publishedAt`)を過ぎた後**。
- **効力の日時(`effectiveAt`)の前**(予告にならないので、効いた後はコマンドが止める)。
- 公開と効力の間は30日以上あけてある(CI)。公開した日のうちに送るのを目安にする。

## 手順

1. 版を確かめる: 画面 `/legal/<文書>/<版>` が出て、「これから効く版」になっていること。要約が正しいこと。
2. 試し(数えるだけ。何も送らない)。ECS の API のイメージで、移行と同じ接続(表の持ち主)・`SUPPORT_TENANT_ID` を渡して:
   ```bash
   node dist/cli.js legal-notify terms 2
   ```
   `{"mode":"plan","document":"terms","version":2,"total":123,"counts":{"<組織の ID>":5,…}}` が出る。運営の組織は数えない。
3. 人数が組織の利用者の数と合うかを見る(合わなければ止めて調べる)。
4. 送る:
   ```bash
   node dist/cli.js legal-notify terms 2 --execute
   ```
   `{"mode":"queued",…}`。送信待ち(アウトボックス)に積んだだけで、送り出しが少しずつ Postfix に渡す。
5. 送れたかを見る: 送信待ちが減っていくこと(`platform.outbox` の `legal.change_notified` で `sent_at` が埋まる)・SES の送信数・戻ってきたメール。届かないときは [mail-not-delivered.md](mail-not-delivered.md)。

## 途中で止まったら

- そのまま同じコマンド(`--execute`)を流し直す。**同じ人に同じ版は1回だけ**(`legal.notices` の一意)なので、残りの人にだけ送る。
- 2回届いた人がいても、同じお知らせなら Message-ID が同じ(アウトボックスは、まれに同じ出来事を2回届ける)。

## 記録

- 誰に・いつ送ると決めたか: `legal.notices`(組織ごと。解約で消える)。実際に Postfix に渡した時刻: `platform.outbox.sent_at`。
- 周知した証拠として、送った日・版・人数を運営の記録(チケットなど)にも残す。
