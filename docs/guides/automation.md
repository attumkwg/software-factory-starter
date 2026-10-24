# 自動で動くもの(GitHub Actions)の一覧と、有効にする日

> お金がかかりうるものは、いまは**手動だけ**にしてあります。使い始めるときは、ファイルの中の
> 「有効にする日: ここに日付を入れてください」に日付を書き、その下のコメントを外します。

## 一覧

| ワークフロー | 何をする | 今の状態 | 有効にするとかかるお金 | 有効にする日 |
|---|---|---|---|---|
| `ci.yml` | 整形・型・テスト・E2E・検査 | 自動(PR・main) | Actions の分数だけ(下の「無料枠」) | 有効(品質のライン) |
| `vrt.yml` | 見た目の比べ(VRT)・PR に結果と主な画面をコメント([vrt.md](vrt.md)) | 自動(PR・ラベル `vrt:update`) | Actions の分数だけ(PR ごとに約8分) | 有効(品質のライン) |
| `labeler.yml` | 危険度のラベル | 自動(PR) | ほぼ0(数秒) | 有効 |
| `terraform.yml` | fmt・validate・tflint・Trivy | 自動(infra の PR) | Actions の分数だけ | 有効 |
| `terraform-plan.yml` | AWS に plan を問い合わせ PR にコメント(PR の plan は stg だけ。prod は main のときだけ) | 手動 | AWS の読み取り(ほぼ0)+分数 | ここに日付を入れてください |
| `preview.yml` | PR ごとの環境を立てる・消す | 手動 | AWS: 土台 月 約1.2万円+1本24時間で月 約1,000円 | ここに日付を入れてください |
| `cleanup-previews.yml` | 閉じた PR の環境を毎晩消す | 手動 | ほぼ0(preview と一緒に有効に) | ここに日付を入れてください |
| `deploy.yml` | main → stg、承認 → prod | 手動 | AWS の stg・prod の月額(getting-started の ④) | ここに日付を入れてください |
| `claude.yml` | `@claude` で実装・レビュー | 手動 | Claude の API(使った分)+分数 | ここに日付を入れてください |
| `security-fuzz.yml` | Schemathesis で全 API に変な入力(ロールごと) | 手動 | 分数だけ(相手はジョブの中の compose) | ここに日付を入れてください |
| `cognito-contract.yml` | 偽物の Cognito と同じテストを stg の本物に流す([local-environment.md](local-environment.md)) | 手動(有効にすると毎週月曜)。変数が無ければ飛ばす | 分数だけ+Cognito の利用者が数人(月1万人まで無料) | ここに日付を入れてください |
| `restore-drill.yml` | stg の DB を一時の DB に戻して確かめ、消す([runbooks/db-restore.md](../runbooks/db-restore.md) の 5) | 手動(有効にすると毎月1日)。変数が無ければ飛ばす | 1回 数十円(一時の DB を30分ほど) | ここに日付を入れてください |
| `zap-api-scan.yml` | ZAP の認証つき API スキャン(stg) | 手動 | 分数+stg が少し動く分 | ここに日付を入れてください |
| `vuln-scan.yml` | 定期の脆弱性チェック(Trivy fs・zizmor のオンライン版)。落ちたら Issue(`/cve` で精査する) | 自動(毎週月曜 5:00)・手動でも | 分数だけ(5分ほど) | 2026-10-22 |

コードレビューを自動にする選択肢(`@claude`・Anthropic 公式の Code Review・外部のサービス)は [code-review.md](code-review.md)。

## 有効にするやり方

1. ファイルを開き、`# 有効にする日: ここに日付を入れてください(YYYY-MM-DD)` に日付を書く。
2. その下の、`#` で始まる `on:` の続き(`pull_request:` や `schedule:` など)のコメントを外す。
3. 必要な変数・秘密が入っているか確かめる(getting-started の ③④)。
4. PR にして、危険度「高」(`.github/` を変えるので2人で見る)でマージする。

止めるときは逆に、コメントに戻して日付を消す。急いで止めるだけなら GitHub の画面で
**Actions → 左のワークフロー → 右上の「…」→ Disable workflow** でも止まる(ファイルは変わらない)。

## GitHub Actions の無料枠と、止め方

公開のリポジトリは、標準の実行環境なら Actions は無料で上限がありません。非公開のリポジトリは、Actions に使える時間に無料の枠があります(2026年10月時点、[GitHub の公式の説明](https://docs.github.com/en/billing/concepts/product-billing/github-actions))。

| プラン | 1か月の無料の分数 | 成果物の置き場 | 超えたとき |
|---|---|---|---|
| Free | 2,000分 | 500MB | 支払い方法が無ければ止まる |
| Pro / Team | 3,000分 | 1GB / 2GB | 支払い方法があれば課金(予算で上限) |

- Linux の実行環境は1分 $0.006(超えた分)。
- **このキットの CI は PR 1回で合計 20〜40分くらい**(ジョブを並べて走らせるので、待ち時間は数分〜10分)。無料枠の 2,000分なら、月に 50〜100回の push が目安。
- 使った量は **Settings → Billing and plans(個人は自分の Settings → Billing)→ Usage** で見られる。90% と 100% でメールが来る。

止めたい・減らしたいとき:

| やりたいこと | やり方 |
|---|---|
| お金を絶対に払わない | 支払い方法を登録しない(枠を使い切ったら止まる)か、予算(Budgets)を $0 に |
| 一時的に全部止める | Settings → Actions → General → 「Disable actions」 |
| 1つだけ止める | Actions → そのワークフロー → 「…」→ Disable workflow |
| 1回の時間を減らす | `ci.yml` の重いジョブ(E2E・イメージ)を、`paths` で apps を変えたときだけに絞る |
