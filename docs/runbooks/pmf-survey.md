# 「無くなったら困るか」を聞く・数える

> 仕様: [specs/0046](../specs/0046-pmf-survey.md)・考え方: [guides/before-pmf.md](../guides/before-pmf.md) の「PMF の兆し」。
> 聞く組織を選ぶのは機能フラグ(手順は [feature-flags.md](feature-flags.md))。`pmf-survey-report` は**読むだけ**。`pmf-survey-purge --execute` は**本番の DB から消す操作**(戻せない)。どれも人が打つ。AI は打たない。

ECS の API のイメージで、移行と同じ接続(表の持ち主)・`SUPPORT_TENANT_ID` を渡して流す(`usage-report` と同じ)。

## 聞く組織を選ぶ

1. 聞く相手を決める: 使い続けている組織(継続率は `usage-report`。[usage-records.md](usage-records.md))。使い始めたばかりの組織に聞いても、「困らない」が増えるだけ。
2. 組織に入れる(試し → 本番):
   ```bash
   node dist/cli.js feature-flag <組織の ID> pmf-survey on
   ```
   ```bash
   node dist/cli.js feature-flag <組織の ID> pmf-survey on --execute
   ```
3. 入れた組織の、**使い始めて14日たった人**が、プロジェクトの一覧を開くと聞かれる。答えるか「答えない」を押すと、その四半期はもう聞かれない(1人1回)。代理ログインの社員・運営の組織の人には聞かない。
4. やめるときは `pmf-survey off --execute`(答えの数は残る)。

## 数える(四半期ごと)

```bash
node dist/cli.js pmf-survey-report --round 2026-Q4
```

`{"mode":"report","round":"2026-Q4","tenantsAnswered":6,"counts":{"very_disappointed":14,"somewhat_disappointed":12,"not_disappointed":6,"not_using":2,"skipped":9},"answered":32,"veryDisappointedPercent":43.8,"line":40,"small":false}`

- `--round` を省くと、いまの四半期。
- `answered` … とても困る・少し困る・困らない の合計(割合の分母)。もう使っていない・答えないは入れない。
- `veryDisappointedPercent` が `line`(40%)以上なら PMF の兆し([before-pmf.md](../guides/before-pmf.md))。
- `small: true`(答えが30件より少ない)のうちは、**割合だけで決めない**。話を聞いた結果と一緒に見る。
- 出力は全部の組織を足した数だけ(組織と人の ID は出ない。だれが何と答えたかは DB にも無い)。計画(`docs/product/plan.md`)の「これまでの判断」には割合と件数を書く。

## 古い印を消す(月1回。利用の記録と同じ日に)

「この回は答え終えた」の印(人の ID を持つ)は **400日**で消す。答えの数は人を持たないので残す。

1. 試し(数えるだけ):
   ```bash
   node dist/cli.js pmf-survey-purge
   ```
   `{"mode":"plan","days":400,"before":"2025-09-25","count":120}`
2. 件数がおかしくないかを見て、消す:
   ```bash
   node dist/cli.js pmf-survey-purge --execute
   ```
