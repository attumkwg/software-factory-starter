# 領域: ファイル(files)

> タスクに付ける写真・PDF。目録は DB(スキーマ `files`)、中身は置き場(S3。手元は S3 互換の RustFS)。
> 仕様 [0072](../../specs/0072-file-storage.md)・設計書 [0072](../../designs/0072-file-storage.md)・ADR [0079](../../adr/0079-files-via-signed-urls-under-tenant-prefix.md)・[0080](../../adr/0080-uploaded-files-checked-before-shown.md)。
> 題材を差し替えたら、付け先(タスク)を自分の物(現場・日報)に置き換える。

## エンティティ

| もの | 表 | 持っていること |
|---|---|---|
| ファイル | `files` | 付け先のタスク・上げた人(`uploaded_by`)・元の名前・種類・大きさ・状態・作った日時 |
| 中身 | 置き場(S3) | `incoming/<組織>/<ファイル>`(上げただけ)・`files/<組織>/<ファイル>`(確かめて書き直した物) |

## 状態

- `pending`(上げる準備をした)→ `ready`(確かめて書き直した。見られる)/ `rejected`(種類・大きさが違う・壊れている)。戻らない。
- 消すとすぐ行が無くなり、中身は送り出しが消す。消した中身は置き場の前の版として 30日残る(運営が戻せる)。

## 守るルール

1. **置き場のキーは `src/storage/keys.ts` の `objectKey` だけで作る**。組織の ID はセッションから。名前はキー・URL・ログに入れない。
2. **署名つき URL は認可の関所を通った後でだけ作る**。期限は5分。署名はその組織のキーの頭だけに絞った権限で(ADR 0079)。
3. **上げた物はそのまま見せない**。送り出しが中身を読み直し、種類を確かめ、写真の付いた情報(位置・日時・機種)を消してから `ready` にする(ADR 0080)。
4. 受ける種類は JPEG・PNG・WebP・PDF、大きさは 1つ 20MB まで(`packages/shared` の `FILE_LIMITS`)。
5. 上げられるのは admin と member。上げ終えるのは上げた本人だけ。消せるのは上げた本人か admin(`policy.ts` の `canTouchFile`)。
6. 他の組織のファイル・タスクは、ID を指定しても「無い」(404)。
7. 行が消えると(本人・タスクやプロジェクトの cascade・解約)、引き金が `files.file_deleted` を積む。中身を残さない。

## 他の領域との境目

| 相手 | 渡すもの | 受け取るもの |
|---|---|---|
| tasks | — | タスクがあるか(`taskExists`)。タスクを消すと行も消える(外部キーの cascade) |
| organizations | — | 組織と利用者(誰が上げたか) |
| 置き場(`src/storage`) | 組織の ID とファイルの ID | 署名つき URL・中身 |

## 関係するファイル

- `apps/api/src/domains/files/`(スキーマ `files`)・`apps/api/src/storage/`(置き場・キー・絞った権限・付いた情報の削除)
- `apps/api/drizzle/0023_file_storage.sql`(表・RLS・引き金)
- 結合テスト: `files.int.test.ts`(2社・自分の物と他人の物・ログ)・`files-object-store.int.test.ts`(S3 互換の置き場で署名の書き換えが断られる)

## これから決めること

- 設計書 0072 の未確定事項(U-1〜U-6: 種類・上限・戻せる期間・書き出し・撮った日時・要配慮)
- 縮小版(サムネイル)・HEIC・動画・ウイルスの検査
