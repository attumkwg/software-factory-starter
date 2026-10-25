# 手順書: 要配慮個人情報の段を上げる(段1を使い始める・段2・段3)

> 段の分け方は [ADR 0018](../adr/0018-sensitive-data-isolation.md)、段1の作りは [ADR 0029](../adr/0029-sensitive-data-tier1.md)。
> **AWS と本番の DB への操作は人が打つ**(AI は手順を確かめた形で渡すまで)。どの段でも、上げる前に `/design` で設計書を書き、段2・段3は ADR を足す。
> 移し替えは止めずに段階を踏む(`db-migration` の 拡張 → 移し替え → 縮小)。要配慮のデータはこの作業の間もログ・Slack・AI に貼らない(件数と ID まで)。

## 0. いまの段と、上げる目安

| 段 | 形 | 上げる目安(どれか1つ) | 費用の目安(1環境・月) |
|---|---|---|---|
| 0 | 要配慮の列を置けない(Terraform `sensitive_data_enabled = false`。DB には空のスキーマとデータ鍵の表だけ) | 要配慮の列を足す機能の仕様が承認された | 0 |
| 1 | 同じ DB の別スキーマ `sensitive`・専用のロール `app_sensitive`・専用の KMS の鍵で組織ごとのデータ鍵を包む | 要配慮の行が数千件を超えた・大きなお客さんが「別の DB」を求めた・監査で「DB の管理者から分けて」と求められた・要配慮の読み書きで本体の DB が重くなった | 約250円+KMS の呼び出し |
| 2 | **別の Aurora クラスター**(同じ AWS アカウント) | 社員の誰が読めるかを AWS アカウントの権限で分ける必要が出た・法令や契約で「別の環境」と求められた | Aurora 1つぶん(最小 0.5 ACU で 月 約7,000円〜)+バックアップ |
| 3 | **別の AWS アカウント**(Organizations の中) | — | 上に加えて、つなぐ費用(VPC のピアリング・PrivateLink)と運用 |

- 迷ったら上げない(上げると費用と運用が増える)。けれども「上げる目安」に当たったのに上げないなら、その理由を ADR 0018 の見直しとして残す。
- 大きなお客さんが「バックアップの中も暗号で消して」と求めたら、段ではなく **T-5**(その組織だけ KMS の鍵を分ける。下の 4)。

## 1. 段1を使い始める(段0 → 段1)

前に: 要配慮の列を足す機能の仕様が承認されている。プライバシーポリシーに取得する要配慮の項目と目的を書き、取る前に本人の同意を取る画面がある(個人情報保護法 20条2項。`docs/guides/legal-documents.md`)。

1. **Terraform**(stg → prod の順。人が): `*.auto.tfvars` に `sensitive_data_enabled = true`(CloudTrail のロググループがあれば `cloudtrail_log_group_name` も)→ plan を見る(足されるのは KMS の鍵と別名・秘密 `<名前>/sensitive-database-url`・API のタスクの環境変数 2つ)→ apply。
2. **DB の接続ユーザーを1回だけ作る**(README の「アプリの接続ユーザーを1回だけ作る」と同じ所で。ロール `app_sensitive` は移行 0013 が作ってある。パスワードは Secrets Manager の `<名前>/sensitive-database-url` の中の値):

```sql
CREATE ROLE app_sensitive_login LOGIN PASSWORD '<sensitive-database-url の中のパスワード>' NOSUPERUSER NOBYPASSRLS IN ROLE app_sensitive;
```

3. **デプロイ**(ふつうの手順)。API のタスクが新しい環境変数で立ち上がる。
4. **確かめる**(stg で):
   - API のログに「設定が正しくありません」が無い(stg・prod は KMS の鍵が無いと起動しない)
   - 要配慮の機能を1回使い、CloudTrail(コンソール → CloudTrail → イベント履歴、イベント名 `GenerateDataKey`)に、API のタスクの役割・文脈 `tenant_id` つきで1件ある
   - 見張りがあるなら、アラーム `…-sensitive-key-*` の3つが「OK」か「データ不足」

## 2. 段2: 別の Aurora クラスターへ(段1 → 段2)

段1は最初から接続が別(`SENSITIVE_DATABASE_URL`)で、`sensitive` の表はほかのスキーマへ外部キーを張っていない。だから**アプリのコードはほぼ変えずに、接続先を変える**。

1. **ADR と設計書を足す**(なぜ上げるか・止める時間・戻し方)。移行のファイルを分ける: `sensitive` のスキーマの移行を `apps/api/drizzle-sensitive/` に移し、`src/db/migrate.ts` に2つ目の移行の先(`SENSITIVE_MIGRATION_DATABASE_URL`)を足す。この変更は段2の PR で作る(いまは無い)。
2. **① 拡張**: Terraform で2つ目の `modules/aurora`(名前 `<名前>-sensitive`)を足す。鍵は Aurora の鍵を別に作る・バックアップも別の保管庫(`modules/backup`)。セキュリティグループは API のタスクからだけ。`modules/sensitive-data` の `db_endpoint` を新しいクラスターの入口に変える(秘密の接続文字列が新しい入口になる。まだ API には効かない: タスクを入れ替えるまで前の値)。
3. 新しいクラスターに、ロール(上の 1. の 2)と `sensitive` の移行だけを流す。
4. **② 移し替え**(要配慮を書く機能を止めてから。機能フラグを `off` にする PR をデプロイ。読むだけの機能は止めなくてよい):

```bash
# 古いクラスター(表の持ち主)から sensitive のスキーマだけを書き出し、新しいクラスターへ入れる。値は暗号文のまま動く(鍵は KMS にあるので、DB をまたいでも開ける)
pg_dump --schema=sensitive --data-only --format=custom "$OLD_OWNER_URL" > sensitive.dump
pg_restore --data-only --dbname="$NEW_OWNER_URL" sensitive.dump
```

   - 行の数を表ごとに比べる(`select count(*) from sensitive.<表>` を両方で)。**中身は見ない**(暗号文でも、貼らない)。
   - `sensitive.dump` は作業の端末に残さない(終わったら消す。暗号文だが、包んだ鍵も入っている)。
5. **③ 切り替え**: API のタスクを入れ替える(デプロイをやり直す。新しい接続文字列を読む)。要配慮の機能を1回使って確かめ、機能フラグを戻す。
6. **④ 縮小**(1週間たってから・別の PR): 古いクラスターの `sensitive` の表を消す移行。古いクラスターのバックアップには、保存期間(最長365日)まで暗号文が残る(`data-retention.md` に行を足す)。
7. 戻し方: 切り替えの後に戻すなら、`db_endpoint` を元に戻して apply → タスクを入れ替える。新しいクラスターで書いた分は、上の 4 と同じ形で古い方へ書き戻す。

## 3. 段3: 別の AWS アカウントへ(段2 → 段3)

1. **ADR と設計書を足す**。Organizations に要配慮だけのアカウントを作り、SCP(組織のルール)で「このアカウントの KMS の鍵と DB は、決めた役割からだけ」にする。CloudTrail はそのアカウントの分も同じ置き場所へ。
2. 新しいアカウントに、段2のクラスターと**新しい KMS の鍵**を作る。KMS の鍵はアカウントをまたいで移せないので、**データ鍵を包み直す**:
   - 前の鍵で開き、新しい鍵で包む(`ReEncrypt`。前の鍵に「新しいアカウントの役割が ReEncrypt してよい」を一時的に足す)。暗号文(値)は変えなくてよい(データ鍵の中身は同じ)。
   - 包み直すコマンド(`sensitive-rewrap`)は段3の PR で作る(試し → `--execute`。組織ごとに `kms_key_id` を新しい鍵に書き換える)。
3. API のタスクから新しいアカウントの DB と鍵へ届くようにする(VPC のピアリングか PrivateLink。鍵のポリシーで、こちらの API のタスクの役割を許す)。
4. 2 の 4〜6 と同じ順で、データを移し・切り替え・縮める。前の KMS の鍵は、古いバックアップが全部消えるまで(最長365日)**消さない**(消すと古いバックアップが開けない)。

## 4. 組織ごとの KMS の鍵(T-5。大きなお客さん向け)

- その組織だけ、新しい KMS の鍵で**データ鍵を包み直す**(上の 3 の 2 と同じ `ReEncrypt`。`kms_key_id` をその組織の鍵に)。コマンドは T-5 の PR で作る。
- 契約が終わったら、その組織の鍵を消す予約(30日)。消えた後は、**バックアップの中のその組織の要配慮のデータも開けない**(暗号による消去)。ふつうのデータ(組織の名前・タスクなど)はバックアップの保存期間で消える。
- 鍵の数が増える(1本 月 約150円)ので、契約の値段に入れる。

## 5. 鍵の扱い(どの段でも)

- KMS の鍵は**消さない**。消すと全部の組織の要配慮のデータが戻せない(バックアップも)。消す予約・止める操作は、アラーム `…-sensitive-key-admin-changes` が鳴る([alarms.md の sensitive-key](alarms.md#sensitive-key))。予約されたら 30日のうちに `CancelKeyDeletion`。
- 鍵の中身は1年ごとに自動で回る(前の版でも開ける。こちらの作業は無い)。
- 鍵が漏れたかもしれない(API のタスクの役割が盗まれた・データ鍵がメモリから取られた): [secret-leak.md](secret-leak.md) の型で、役割の権限を止め、[personal-data-breach.md](personal-data-breach.md) で要配慮の漏えいとして判定する(要配慮は1件でも報告)。
