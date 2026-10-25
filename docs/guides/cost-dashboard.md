# 費用のページ(何にいくらかかっているか)

> 「今いくらかかっていて、動いている物ごとにいくら投入されているか」を1枚で見る仕組み。AWS・GitHub Actions・AI・そのほかの SaaS を混ぜ、見積もり(段階の表)と並べる。
> ページは**使う側の非公開の S3** にだけ置く(公開のリポジトリ・公開の成果物・GitHub Pages には出さない)。判断は [ADR 0032](../adr/0032-evidence-and-cost-outside-the-repo.md)・決まりは [設計書 0019](../designs/0019-evidence-soa-and-cost.md)。

## 1. 何が見えるか

| 欄 | 中身 | 元 |
|---|---|---|
| 今月の合計・月末の見込み・見積もり | 今月(今日まで)の合計と、月末の見込み(AWS は Cost Explorer の見込み・ほかは日割り)。見積もりの上を超える見込みなら ⚠ | 全部 |
| 何にいくら(動いている物ごと) | AWS はタグ `Component`(api・web・mail・db・network・shared)・Actions・SaaS(AI の席などを含む)は1つずつ | Cost Explorer・Actions・`docs/cost/saas.yaml` |
| 見積もりと実績(区分ごと) | 本番+stg・PR ごとの環境と CI・AI・有料の検査を、見積もりの幅(薄い帯)と並べる。上を超えたら ⚠ | `docs/cost/estimates.yaml`(元は [段階と費用](../concepts/stages.md) の 4.) |
| 環境ごと・賭けごと | タグ `Environment`・`Bet`(賭けの ID。土台は `core`)。賭けごとは `/ledger`(資産か費用か)の土台 | Cost Explorer・`saas.yaml` の `bet` |
| AWS の月ごと・日ごと・サービスごと | 前の3か月と今月・今月の日ごと・AWS のサービスの上の10 | Cost Explorer |
| PR ごとの環境 | タグ `PullRequest`(dev のアカウント) | Cost Explorer |
| GitHub Actions | ワークフローごとの実行の数と分数(非公開なら、枠を超えた分を金額に) | Actions の API |
| 読めなかった物・足りない物 | 役割が無い・鍵が無い・金額を書いていない SaaS。**0円として隠さない** | — |

金額は目安(1ドル = `estimates.yaml` の `usd_jpy` 円で換算・税は含まない)。正は請求書。

## 2. 始める(一度だけ。人がやる)

1. **Terraform を apply する**(人が CI で。stg・prod・preview/base)。全部のリソースにタグ `Bet`・`Component` が付き、役割 `…-cost`(Cost Explorer を読むだけ。prod は置き場へ書くのも)・prod に置き場 `module.cost_reports`・費用の急な変化の見張り(`module.cost_watch`)ができる。
2. **翌日以降に、コスト配分タグを有効にする**: 変数 `activate_cost_allocation_tags = true` で apply(タグが請求に出てからでないと有効にできない)。AWS Organizations の中のアカウントなら、管理のアカウントの「請求 → コスト配分タグ」で `Project`・`Environment`・`Component`・`Bet`・`PullRequest` を有効にする。有効にした日より前の費用には、タグが付かない(「タグなし」に出る)。
3. **変数を入れる**(Settings → Secrets and variables → Actions → Variables): `AWS_PROD_COST_ROLE_ARN`・`COST_BUCKET`(prod の出力 `cost_bucket`)。あれば `AWS_STG_COST_ROLE_ARN`・`AWS_DEV_COST_ROLE_ARN`。役割はどれも main のコードからだけ引ける。
4. **SaaS の月額を書く**: `docs/cost/saas.yaml`。AI の席・使用料もここ(`category: ai`。API で自動では取らない。設計書 0019 の U-4)。**公開のリポジトリなら金額を書かない**(名前だけ。ページに「金額なし」と出る)。
5. Actions → Cost → Run workflow(main で)を流す。毎日にするなら、`cost.yml` の「有効にする日」を書いて `schedule` を生かす(1日 最大 約27円。[automation.md](automation.md))。

## 3. 見る

- AWS のコンソール → S3 → `COST_BUCKET` → `cost/latest/index.html` → 「開く」。または手元で期限つきの URL を作る(1時間):

  ```bash
  aws s3 presign "s3://<COST_BUCKET>/cost/latest/index.html" --expires-in 3600
  ```

  URL は人に渡すと期限まで誰でも開ける。チャットや Issue に貼らない。
- 月ごとの写しは `cost/<年-月>/`(JSON も。`summary.json` がページの元)。古い版は400日で消える。
- 手元で試す(AWS は読まない。Actions・SaaS・見積もりだけ): `pnpm cost --out <フォルダ>` → `<フォルダ>/index.html`。

## 4. 「動いている物ごと」を増やす

- 新しく動かす物(キュー・検索など)を Terraform で足すときは、`envs/<環境>/versions.tf` の provider の別名(`aws.api` など)をモジュールに渡すか、新しい `Component` の別名を足す。何も渡さなければ `shared`。
- 賭け(`docs/product/bets/B-NNNN`)だけのために足すリソースは、リソースの `tags` に `Bet = "B-NNNN"` を書く。賭けをやめて消せば、その賭けの費用が止まったことがページで分かる。
- AWS の外の物は `docs/cost/saas.yaml` に1行(`bet` も)。

## 6. 人の時間と賭けごとの損益(PL)

> 人の時間は**推定**。① 自動の目安(今月作った PR を本文の「取り組み」で賭けに分け、1件あたりの分数を掛ける。分数は `docs/cost/people.yaml`)と ② 手入力(週1回、人ごとに賭けの割合)を並べ、**幅**で見せる。人の評価には使わない。決まりは [設計書 0020](../designs/0020-people-time-and-bet-pl.md)・[ADR 0033](../adr/0033-people-time-and-bet-pl.md)。

1. **時給を決める**(人ごとか役割ごと): 時給 = 年の給与 × 1.3〜1.5(会社の負担: 社会保険・福利厚生・場所・道具)÷ 年の働く時間(約1,800〜2,000時間)。業務委託は請求の時給。
2. **非公開の置き場に置く**(リポジトリには置かない。形は `docs/cost/inputs-example/` の見本):

   ```bash
   aws s3 cp rates.json "s3://<COST_BUCKET>/cost/inputs/rates.json"
   ```

   `time.csv`(週ごとの割合)と `revenue.csv`(月ごとの売上)も同じ場所に。週に1回、`time.csv` に行を足して置き直す。
3. ページの「賭けごとの損益(PL。推定)」の表: 売上・インフラと SaaS(タグ `Bet`・`saas.yaml` の `bet`)・共通の配り分(既定は人の時間の割合。`people.yaml` の `allocation`)・人の時間(目安/手入力)・人の費用・原価・粗利・判定(⚠ 赤字 / 黒字 / 分からない(幅の中)/ 売上なし / 単価なし)。
4. 月1回、Claude Code で `/ledger`: 同じ集計の `ledger.csv`(資産の候補・費用・除却の候補の案と根拠の PR)を確かめ、賭けのファイルの「会計区分の判定」に足す。会計・税の当てはめは専門家と。

## 5. 知らせ

- 予算(AWS Budgets): 月の上限の 80% を使った・月末の見込みが上限を超える(`monthly_budget_usd`)。前からある
- 急な変化(Cost Anomaly Detection): このプロダクト(タグ `Project`)の費用が、いつもより急に増え、見込みの影響が `anomaly_threshold_usd`(既定 $10)以上。Slack に来る
- 見積もりとのずれ: 四半期ごとの点検 `cost-review` で、このページを見て答える
