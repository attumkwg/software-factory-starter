# 機能フラグ(組織ごとに、機能を出す・止める)

> 賭けの `psf` / `rollout` で「選んだ組織にだけ出して、使われるかを見る」ための仕組み。仕様: [specs/0012](../specs/0012-feature-flags-and-usage.md)・ADR: [0025](../adr/0025-feature-flags-and-usage-records.md)・賭けの考え方: [bets-and-assets.md](bets-and-assets.md)。
> 本番で入れる・切るのは手順書 [runbooks/feature-flags.md](../runbooks/feature-flags.md)(人が打つ。AI は打たない)。

## 何がどこにあるか

| 物 | 場所 | 誰が変える |
|---|---|---|
| 定義(名前・どの賭けか・説明・状態) | `packages/shared/src/feature-flags.ts` の `FEATURE_FLAGS` | PR(人が見る) |
| 組織に入れた(行がある = 入っている) | 表 `platform.feature_flags`(`tenant_id`+RLS) | 運営のコマンド `feature-flag` だけ |
| 入れた・切ったの記録 | その組織の監査ログ(`feature_flag.enable` / `feature_flag.disable`。「仕組み」として) | コマンドが自動で |

状態は3つ:

| 状態 | 誰に出るか | 使う時 |
|---|---|---|
| `rollout` | 運営が入れた組織だけ | 賭けの `psf`(話を聞く組織だけ)・`rollout`(選んだ組織に出す) |
| `on` | 全部の組織(行は見ない) | 賭けの `adopted`(定着した) |
| `off` | 誰にも出ない(行があっても) | 壊れたときに全部で止める。デプロイ(数分)で効く |

## 足す(新しい機能を出し分ける)

1. 賭けがあるか確かめる(`/bet`)。段階が `psf` / `rollout` でないと、フラグは作れない(単体テスト `apps/api/test/unit/feature-flags.test.ts` が落ちる)。
2. `FEATURE_FLAGS` に1行足す。名前は英小文字・数字・`-`(例 `morning-digest`)。**一度使った名前は使い回さない**(消した機能の古い行が生き返るため)。
   ```ts
   { name: "morning-digest", bet: "B-0002", description: "期限が近いタスクを朝にまとめて知らせる", state: "rollout" },
   ```
3. API: 機能の API のハンドラーの最初で守る(入っていなければ 404。無い API と同じに見せる)。
   ```ts
   import { requireFeature } from "../../feature-flags/index.ts";
   // …
   async (c) => {
     await requireFeature(c, "morning-digest");
     // …
   }
   ```
   権限は今までどおり `policy.ts`(フラグは「出すか」だけ)。新しい API なら `/add-api-endpoint` の手順も全部。
4. 画面: `GET /api/me` の `features` で出し分ける。**守りは API 側**(画面で隠すだけで安心しない)。
   ```tsx
   import { hasFeature } from "@app/shared";
   {hasFeature(me, "morning-digest") && <Link to="/digest">朝のまとめ</Link>}
   ```
5. テスト: 定義を差し替えたアプリ(`createTestApp(url, {}, { featureFlags: [...] })`)で、入れた組織と入れていない組織の2社を書く(見本は `test/integration/feature-flags.int.test.ts`)。
6. PR の「取り組み」は `bet:B-NNNN`。

## 使われたかを測る(利用の記録)

賭けの線(「入れた組織の何割が4週続けて使うか」など)は、利用の記録で測る。

1. 機能の API のハンドラーで、使ったことを記録する(操作と同じトランザクション。1日1人1機能1行):
   ```ts
   import { recordUsage } from "../../usage/index.ts";
   // …
   async (c) => {
     await requireFeature(c, "morning-digest");
     // … 操作 …
     await recordUsage(c, "morning-digest");
   }
   ```
   画面を開くだけの機能なら、その画面の `loader` が読む GET の API で呼ぶ。**画面から「使った」を送る API は作らない**。
2. 記録するのは「どの組織の・誰が・どの機能を・どの日に」だけ。何をしたか・中身・時刻・URL・IP は記録しない(設計書 0012 の 2)。代理ログインの社員・運営の組織の人は記録されない。
3. 数えるのは運営のコマンド `usage-report`(手順書 [runbooks/usage-records.md](../runbooks/usage-records.md))。1行目は週ごとの使った組織・人の数、2行目は**継続率**(初めて使った週ごとの組で、N 週後に使った割合 `activePct` と N 週続けた割合 `continuedPct`。組織と人の単位。仕様 [0022](../specs/0022-usage-retention.md))。どちらも数と割合だけで、組織と人の ID は出ない。小石には組を足し合わせた行(`overall`)の割合で書く。小さい組(`small: true`)は割合だけで判定しない。
4. 記録は400日で消える(`usage-purge`。月1回)。

## 出す・広げる・止める・片づける

| したいこと | すること |
|---|---|
| 1つの組織に出す・外す | 手順書のコマンド(`feature-flag <組織の ID> <機能> on|off`)。試し → `--execute` |
| 全部に出す(賭けが `adopted`) | 状態を `on` にする PR。組織の行はそのままでよい(効かなくなる) |
| 壊れたので全部で止める | 状態を `off` にする PR → デプロイ。直したら元の状態に戻す PR |
| 撤去する(賭けが `retired`)・やめた(`dropped`) | 定義と、`requireFeature` / `hasFeature` / `recordUsage` の呼び出しと、その機能のコードを一緒に消す PR。残っていると単体テストが落ちる。組織の行は残っても効かない(解約で消える) |

- 出す組織を選んだら、賭けの小石に「何組織に出したか」を数で書く(**組織の名前・ID は書かない**)。
- 出す組織に前もって知らせるか(「新しい機能を試しに入れました」)は、賭けごとに決める。知らせると使い方が変わる(話を聞く `psf` なら知らせる・`rollout` で自然に使われるかを見るなら知らせない、など)。

## やらないこと(いまは無い)

- 割合での公開(「組織の 10% に出す」)・A/B テストの組分け。PMF の前は組織を選んで出す方が、話を聞きに行ける。
- 人ごとのフラグ(組織の中の一部の人だけ)。
- デプロイなしで全部を一度に止める。
- お客さんの管理者が画面で入れる・切る(設計書の未確定事項 U-1)。
