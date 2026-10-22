# 手順書: 他社のデータが見えたかもしれない

> 一番重い事故。**疑いの段階で始める**(確かめてからでは遅い)。迷ったら上に上げる。

## 0. 最初の15分

1. **当番の責任者に連絡**し、Slack の `#incident` にスレッドを立てる(何を見たか・いつ・誰から)。**最初に知った日時**もここに書く(個人情報保護委員会への報告の期限が、ここから数え始まる。[personal-data-breach.md](personal-data-breach.md) の 0)。
2. **証拠を残す**: 報告のスクショ・URL・時刻・利用者。`requestId` が分かれば控える。
3. **広がりを止める**(どれか):
   - 原因の機能が分かる → 機能フラグで止める
   - 直前のデプロイが怪しい → 前の版に戻す(`deploy.yml` を前のイメージで流す / ECS のロールバック)
   - 分からない → メンテナンス画面(WAF のルールで全体を止める。[incident.md](incident.md) の 3)を責任者が判断

## 1. どこから漏れたか(CloudWatch Logs Insights)

全ログに `requestId` / `tenantId` / `traceId` が入っている。

```
fields @timestamp, requestId, tenantId, method, path, status
| filter requestId = "<報告の requestId>"
```

```
# あるテナントのセッションで、他テナントの ID が出てくる応答が無いか
fields @timestamp, tenantId, path, status
| filter tenantId = "<報告した人の tenantId>" and path like /<相手の ID>/
```

見る所の順番(漏れ方の一覧は docs/security.md の L-1〜L-9):

1. API: リポジトリで `tenant_id` の絞り忘れ → それでも RLS が止めるはず。止まっていなければ **RLS が外れている**(移行・接続ユーザー)
2. 接続ユーザー: `select rolsuper, rolbypassrls from pg_roles where rolname = current_user` が false か、表の持ち主でつないでいないか
3. キャッシュ・ファイル・キュー: キーやパスにテナントがあるか
4. 書き出し・管理画面・ログ

## 2. 影響の範囲

- いつから(原因のデプロイの時刻)・どのテナントの・どのデータが・どのテナントに見えたか。
- どの表・どの列が見えたかを、個人データか・要配慮個人情報かに分け、人数を数える([personal-data-breach.md](personal-data-breach.md) の 1)。
- 見えた側と見られた側のテナントの一覧を、責任者と法務に渡す。

## 3. 直す

1. 直す PR に**その漏れを再現するテスト**を必ず付ける(`docs/authz/matrix.yaml` に行を足す・2社の結合テスト)。
2. 同じ形の穴を **Semgrep のルール**(`.semgrep/rules.yml`)にして、他の場所も一斉に探す。
3. `CLAUDE.md` かスキルに「この領域ではこう書く」を足す(AI が同じ間違いをしない)。
4. PR は危険度「高」。2人でレビュー。

## 4. 知らせる

- **個人データが見えた(かもしれない)なら** [personal-data-breach.md](personal-data-breach.md) へ: 報告が要るかの判定・速報(おおむね3〜5日)と確報(30日。不正の目的なら60日)・お客さん(委託元)へ知らせる・本人への通知。見られた側のお客さんには、**知ってから3〜5日のうちに**知らせる。
- 最後に決めるのは責任者と法務(契約の期限も確かめる)。
- 事後の振り返りを1週間以内に。「仕組みのどこを直したか」を ADR か手順書に残す。
