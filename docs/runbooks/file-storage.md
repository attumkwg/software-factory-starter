# 写真・ファイルの置き場

> 仕様: [specs/0072](../specs/0072-file-storage.md)・設計: [designs/0072](../designs/0072-file-storage.md)・[ADR 0079](../adr/0079-files-via-signed-urls-under-tenant-prefix.md)・[ADR 0080](../adr/0080-uploaded-files-checked-before-shown.md)・Terraform: `infra/terraform/modules/file-storage`。
> 置き場は本番のお客さんのデータ(写真に人・表札が写りうる)。**中身を開く・写す・消すのは人**。AI は打たない・中身を受け取らない(AI-6。受け取ってよいのは組織・ファイルの ID と数まで)。

置き場のキーは `<段>/<組織の ID>/<ファイルの ID>`(段は `incoming` = 上げただけ・`files` = 確かめて書き直した物)。名前はキーに入らない(DB の `files.files.name`)。

## 1. 入れた後に一度だけ: 組織ごとの絞りが効いているか(stg)

手元・CI の置き場(RustFS)は固定の鍵なので、組織ごとに絞る権限(STS のセッションのポリシー)の効き目は stg で確かめる。

1. stg に2つの組織(A・B)と、A のタスクに写真を1枚上げる(API の `POST /api/tasks/{taskId}/files` → 返った URL に PUT → `complete`)。
2. A の人で `GET /api/files/{fileId}` を呼び、返った `downloadUrl` が開けることを確かめる。
3. その URL のパスの `files/<A の組織の ID>/` を `files/<B の組織の ID>/` に書き換えて開くと、**403** になることを確かめる(署名が合わない)。
4. CloudTrail の `AssumeRole` に、セッションの名前 `files-<組織の ID>` が出ていることを確かめる(組織ごとに1時間に1回ほど)。

## 2. 誤って消した写真を戻す(消してから30日の間)

消すと DB の行が無くなり、置き場の今の版も消える(前の版は `noncurrent_expire_days`・既定 30日 残る。設計書 0072 の U-3)。

1. お客さんから、どのタスクの・いつごろの写真かを聞く(**写真そのもの・名前を AI に渡さない**)。
2. 監査ログの `file.delete` から、ファイルの ID を探す(管理者の画面か `GET /api/audit-events`)。
3. 本番のアカウントの人が、置き場の前の版を探す:

   ```bash
   aws s3api list-object-versions --bucket <名前>-prod-files-<アカウント> --prefix files/<組織の ID>/<ファイルの ID>
   ```

4. 前の版を今の版に戻す(`copy-object --copy-source "<置き場>/<キー>?versionId=<版>"`)と同時に、DB の行を作り直すのは手作業になる(名前・大きさ・上げた人は監査ログと前の版の Content-Disposition から)。戻したら、監査ログに残らないので運営の記録(Issue)に「いつ・どの ID を・誰の頼みで」を残す。

## 3. 解約の前に「写真を全部ください」と言われたら

書き出し(`POST /api/exports`)の JSON には一覧(名前・大きさ・時刻)だけが入り、中身は入らない(設計書 0072 の U-4)。

1. 契約で渡すと決めているかを確かめる(渡し方・期限。導入時に決める)。
2. 本番のアカウントの人が、その組織の `files/<組織の ID>/` を、お客さん専用の期限つきの置き場へ写して渡す(`aws s3 sync`)。**ほかの組織の頭を混ぜない**(頭は組織の ID で終わる `/` まで書く)。
3. 渡し終えたら写しを消し、いつ・誰に・何件を渡したかを残す(名前は残さない)。

## 4. 解約で消す

`delete-tenant` が、DB を消す前に `incoming/<組織>/`・`files/<組織>/` の中身を前の版と消した印まで全部消す([offboarding.md](offboarding.md) の 2・4)。試しのログの `objects` が消す数。

- 消した後に `aws s3api list-object-versions --prefix files/<組織の ID>/` が空であることを確かめる。

## 5. 上げたのに見られない(`rejected` のまま・`pending` のまま)

- `rejected`: 種類が言った物と違う・大きさが違う・形が壊れている。ログの `reason`(`type_mismatch`・`size_mismatch`・`too_large`・`broken`・`not_uploaded`)で分かる(名前・中身はログに出ない)。上げ直してもらう。
- `pending` のまま: 送り出し(アウトボックス)の `files.file_uploaded` が止まっている。[alarms.md](alarms.md) の送り出しの手順で、dead になった出来事を見る。置き場に届かない(STS・KMS の権限)なら、失敗の種類がログに出る。
- 24時間 `pending` の物は一覧に出なくなり、`incoming/` の中身は1日で消える。

## 6. 費用

保存 1GB 月 約3.8円(東京)。費用のページの `Component = api` に入る。急に増えたら、どの組織の頭が大きいかを S3 Storage Lens か `aws s3 ls --summarize --recursive s3://…/files/<組織の ID>/` で数える(中身は開かない)。
