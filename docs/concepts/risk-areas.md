# 危険度「高」の場所と、そのセンサー

> **ここが「どこを人が判定するか」の正**。[line.md](line.md) の 5 の表の「高」の言葉と、守る場所の一覧(`.claude/hooks/protected-paths.json`・`.github/labeler.yml` の `risk:high`・`.github/CODEOWNERS`)を、`pnpm guards` が毎回突き合わせる。ずれたら CI が落ちる。
> このファイル自身も守る場所(AI は人の確認なしに変えない)。決めた理由は [ADR 0084](../adr/0084-guard-the-sensors.md)。

## 考え方: コードではなく、センサーを守る

- 🧪 **人が読むのはコードではない**。コードが正しいかはセンサー(テスト・型・検査)が確かめる。人が判定するのは「**センサーが正しいか**」と「**人が決めなければならない所**」だけ。
- 🔒 だから、お金・個人データ・ログインの入口・顧客への連絡は、**その場所を確かめるテストを守る場所に入れる**。コードは AI が変えてよい(センサーが緑なら、扱いは変わっていない)。
- ❓ **扱いを変えるときは、テストも変わる** → テストは守る場所なので、人の答えが要る PR になる → 人には下の表の「問い」を1行で聞く。人はコードを読まずに、問いに「はい / いいえ」で答える。1人の間は、その答えを会話でもらい、工場が PR に残してからマージする(`pnpm pr:merge-when-green`。ADR 0085)。人が増えたら人の承認に戻る。
- 🧱 認証・認可・DB の移行・インフラ・CI は、前からコードそのものも守っている(戻せない・自分のチェックを自分で緑にできる場所)。ここは変えない。

## 1. 「高」の領域

「領域」の列の頭の言葉は、[line.md](line.md) の 5 の表の「高」の行の言葉と同じにする(`pnpm guards` が1つずつ探す)。「守る場所」の列の道は、全部が `protected-paths.json` に入っていること。「センサーが確かめるコード」の列の道は、あること。

| 領域 | 守る場所(人が判定する) | センサーが確かめるコード(AI が変えてよい) | 守る場所を変えたら聞く問い |
|---|---|---|---|
| 認証(ログイン・SSO・SCIM) | `apps/api/src/auth/**`・`apps/api/test/integration/sso-login.int.test.ts`・`apps/api/test/integration/sso-required.int.test.ts`・`apps/api/test/integration/scim.int.test.ts`・`apps/api/test/unit/scim-protocol.test.ts` | `apps/api/src/sso/**` | ログインの入口(SSO・SCIM を含む)で、入れる人・止まる人を変えてよいか |
| 認可(権限と監査の記録) | `apps/api/src/authz/**`・`docs/authz/**`・`apps/api/test/integration/authz-matrix.int.test.ts`・`apps/api/test/unit/authz-coverage.test.ts`・`apps/api/test/unit/audit-coverage.test.ts` | `apps/api/src/audit/**` | 誰が何をできるか・何を記録に残すかを変えてよいか |
| 課金(プラン・価格表・利用の数) | `packages/shared/src/plans.ts`・`packages/shared/src/plans.test.ts`・`packages/shared/src/money-time.test.ts`・`apps/api/test/unit/plans.test.ts`・`apps/api/test/integration/plans.int.test.ts`・`apps/api/test/integration/usage-records.int.test.ts`・`apps/api/test/unit/usage-retention.test.ts`・`apps/api/test/unit/tenant-shares.test.ts`・`apps/api/test/integration/tenant-shares.int.test.ts` | `apps/api/src/plans/**`・`apps/api/src/usage/**` | 契約・請求の扱い(プラン・価格表の版・利用の数え方)を変えてよいか |
| 個人データ(分類とログ) | `apps/api/src/sensitive/**`・`apps/api/test/unit/classification.test.ts`・`apps/api/src/logger.ts`・`packages/logging/**`・`packages/error-reporting/**`・`apps/web/server/logger.ts`・`apps/api/test/integration/personal-data-logs.int.test.ts`・`apps/api/test/integration/personal-data-responses.int.test.ts`・`docs/compliance/vendors.yaml` | — | 個人データの列の扱い・ログに出す物・渡す先を変えてよいか |
| 個人データ(開示・書き出し・削除) | `apps/api/test/integration/person-data.int.test.ts`・`apps/api/test/integration/person-erase.int.test.ts`・`apps/api/test/integration/export-stream.int.test.ts`・`apps/api/test/unit/export-stream.test.ts`・`apps/api/test/integration/audit-export.int.test.ts`・`apps/api/test/integration/offboarding.int.test.ts` | `apps/api/src/person-data/**`・`apps/api/src/export/**`・`apps/api/src/offboarding/**` | 個人データを出す範囲・消す範囲を変えてよいか(消すのは戻せない) |
| 顧客への連絡(メール・全員へのお知らせ) | `apps/api/test/integration/mail.int.test.ts`・`apps/api/test/integration/invitation-mail.int.test.ts`・`apps/api/test/integration/legal-notify.int.test.ts` | `apps/api/src/mail/**`・`apps/api/src/legal-notify/**` | 誰に・何を・いつ送るかを変えてよいか(送ったら戻せない) |
| DB の移行 | `apps/api/drizzle/**`・`apps/api/db/**` | — | 表を変える・消す移行を入れてよいか(戻し方つき) |
| インフラ | `infra/**`・`apps/api/Dockerfile`・`apps/web/Dockerfile`・`docker/**` | — | 本番の作り・権限・費用を変えてよいか |
| CI の設定(守りそのもの) | `.github/**`・`.claude/settings.json`・`.claude/hooks/**`・`scripts/check-guards.mjs`・`scripts/risk-areas-lib.mjs`・`docs/concepts/risk-areas.md` ほか(全部は守る場所の一覧) | — | 検査・守りの線を変えてよいか(弱める変更は「いいえ」が既定) |
| 分離を確かめるテスト | `apps/api/src/db/**`・`apps/api/test/integration/rls.int.test.ts`・`apps/api/test/integration/tenant-isolation.int.test.ts`・`apps/api/test/unit/storage.test.ts` | `apps/api/src/storage/**` | 組織の間の壁の確かめ方を変えてよいか |
| 「してはいけない」を書いた CLAUDE.md | `CLAUDE.md`・`apps/api/CLAUDE.md`・`apps/web/CLAUDE.md`・`docs/CLAUDE.md`・`packages/CLAUDE.md` | — | AI に禁じることを変えてよいか |

## 2. 「中」の場所(センサーが緑なら、AI が進めてよい)

`apps/api/src/` の下の場所は、上の表か、この表のどちらかに必ず書く(`pnpm guards` が見る。新しい場所を足したら、どちらかを決めるまで落ちる)。

| 場所 | なぜ「中」でよいか |
|---|---|
| `apps/api/src/domains/**` | 機能の領域。個人データの列は分類の表(`classification.test.ts`)、組織の間の壁は RLS のテスト、権限は権限の表が守る(どれも上の表) |
| `apps/api/src/onboarding/**` | 組織を作る運営のコマンド。試しが既定で、本当に作るのは運営が申込書を確かめてから |
| `apps/api/src/pre-registrations/**` | 事前登録。メールの列は分類の表、ログに出さないことは `personal-data-logs.int.test.ts` が守る |
| `apps/api/src/outbox/**` | 送る仕組み。何を誰に送るかは「顧客への連絡」のセンサーが守る |
| `apps/api/src/feature-flags/**` | 機能の出し分け。プランで入る機能は「課金」のセンサーが守る |
| `apps/api/src/pmf-survey/**` | 画面の中の問い。答えの列は分類の表が守る |
| `apps/api/src/demo/**` | 営業のデモの組織。本物のお客さんのデータに触らない |
| `apps/api/src/http/**` | 共通の部品(応答の形・IP の取り方)。IP の範囲の守りは `ip-allowlist.int.test.ts` |

## 3. 問いの出し方

- 🙋 守る場所に触る PR は、人の答えが要る PR(`scripts/pr-merge-lib.mjs` の `humanOnlyReasons`)。`pnpm pr:merge-when-green` は、触った領域と上の表の「問い」を出す。AI はそれを「人に判断してほしい所」と Slack の返事に1行で写し、1人の間は持ち主の答えを PR に残してからマージする(人が増えたらマージしない)。
- 🔢 問いは1件の依頼で多くても2つ。AI が決められる所は決めて、2つに絞る(仕様 0085)。それでも3つ以上残るなら、依頼を分ける。
- 🧑‍⚖️ 人が答えるのは問いだけ。「テストを弱めていないか」は CI(`tests:weakened` の印)が先に見る。

最終更新: 2026-10-29
