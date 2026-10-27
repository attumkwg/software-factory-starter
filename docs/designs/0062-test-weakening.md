# 設計: テストと検査を弱めた変更を人の目に出す

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0062-test-weakening.md](../specs/0062-test-weakening.md)
> 状態: 下書き
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

① 検査の設定(カバレッジの下限・Biome・squawk・Playwright)を危険度「高」にする。② PR の差分から「テストか検査を弱めた所」を見つけるワークフロー(`test-weakening.yml` → `scripts/test-weakening.mjs`)を足し、見つかればラベル `tests:weakened` を付けて要約に出す。③ `tests:weakened` の付いた PR は、危険度「高」の承認の人数を数える。

## 作業の前に読んだ物(ガイド)

- `.claude/hooks/protected-paths.json`(当たり方: `x/**` は下の全部、ほかは同じ名前だけ)・`scripts/check-guards.mjs`・`.github/labeler.yml`(`sync-labels: true`。labeler の扱うラベルは付け直される)・`.github/CODEOWNERS`
- `.github/workflows/ai-label.yml`(ラベルを付ける型: 見分けるジョブは読むだけ、付けるジョブは checkout しない・フォークは飛ばす)・`high-risk-approvals.yml`(土台のブランチで流す型)
- `scripts/review-count-lib.mjs`(`isHighRisk` はラベル `risk:high` も見る)
- `.github/labels.yml`(使うラベルは1件ずつ。手引きは `pnpm setup:labels`)
- 各 `vitest.config.ts` の `coverage.thresholds`(`lines`・`functions`・`branches`・`statements`)・`docs/guides/ci-limits.md`
- 穴 G-60・台本 10-3

## 1. 設計方針

- **止めずに印を付ける**。弱める変更にも理由のある物がある(古いテストを消す・不安定な E2E を一時的に飛ばす)。人が理由を見て決める。
- 見つけ方は **差分の形だけ**(正規表現を使わず、文字列で数える。Semgrep の regex_dos)。消した分と足した分を差し引く(付け直しは数えない)。
- 印は labeler と別のラベル `tests:weakened`(labeler の `sync-labels` で `risk:high` を付けても外されるため)。`review-count-lib.mjs` の `isHighRisk` がこのラベルも「高」とみなす。
- **土台のブランチ(`base.sha`)の中身で見つける**。書く権限のジョブ(ラベル)は checkout しない。
- 設定のファイルは名前ごとに守る一覧へ(一覧は `*` を使えない)。足すのは7つ: `apps/api/vitest.config.ts`・`packages/fake-cognito/vitest.config.ts`・`packages/shared/vitest.config.ts`・`biome.json`・`apps/api/.squawk.toml`・`apps/web/playwright.config.ts`・`apps/web/playwright.vrt.config.ts`(`packages/error-reporting/**`・`packages/logging/**` はもう「高」)。

## 2. データモデル

該当なし(DB を使わない)。

## 3. API

該当なし(アプリの API は変えない)。GitHub の REST を `gh api` で読むだけ: `pulls/{n}/files`(名前・状態・元の名前・差分 `patch`)。ラベルは `gh pr edit --add-label / --remove-label`。

## 4. 状態遷移

- ラベル `tests:weakened`: 見つかったら付ける。見つからなくなったら(直して push した)外す。人が手で外しても、次の push でまた付く(理由は PR の本文に書く)。

## 5. システム間連携

- 起動: `pull_request`(opened・synchronize・reopened)。
- 見つけるジョブ: `contents: read`・`pull-requests: read`。土台のブランチを checkout(鍵を残さない)。結果を `found`(true/false)で次へ。要約は `$GITHUB_STEP_SUMMARY` と注釈(`::warning`)に出す。土台にまだスクリプトが無ければ見ない。
- 付けるジョブ: `pull-requests: write`。checkout しない。フォークの PR は飛ばす(ai-label.yml と同じ)。ラベルが無ければ警告だけ。
- ラベルが付くと `high-risk-approvals.yml` が `labeled` で流れ直し、人数を数える。

## 6. 業務ルール

- テストのファイル: 名前に `.test.` か `.spec.` がある。
- 消したテスト: 状態 `removed` のテストのファイル・テストの名前からテストでない名前への `renamed`。
- 飛ばす書き方(テストのファイルの中、空白を詰めて): `.skip(`・`.only(`・`.todo(`・`.fixme(`・`.skipIf(`・`.runIf(`・`xit(`・`xtest(`・`xdescribe(`・`fit(`・`fdescribe(` が、消した行より足した行に多い。
- 確かめが減った(テストのファイルの中): `expect(`・`expect.`・`assert(`・`assert.` の数が、足した行より消した行に多い。
- 下限を下げた(`vitest.config.*`): 消した行の `lines|functions|branches|statements: 数` が、足した行で小さい・無い。
- 検査を黙らせる(どのファイルでも): `biome-ignore`・`@ts-ignore`・`@ts-expect-error`・`@ts-nocheck`・`nosemgrep`・`eslint-disable`・`squawk-ignore`・`gitleaks:allow` が増えた。
- 読めない差分: テストか下限の設定で、GitHub が差分(`patch`)を返さない(大きすぎる)。

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 設定が「高」 | 1 | `pnpm guards`(一覧・labeler・CODEOWNERS) |
| 弱めた所にラベルと要約 | 5・6 | `scripts/test-weakening.test.mjs` |
| 直したら外れる | 4・5 | ワークフローの付けるジョブ(CI で確かめる) |
| ラベルで「高」の人数 | 1 | `scripts/review-count.test.mjs` |
| 土台の物で流す・「高」 | 1・5 | ワークフローの checkout(base.sha)・`protected-paths.json` |
| 読めない差分 | 6 | `scripts/test-weakening.test.mjs` |

## 8. 非機能

- 性能: API 1回(ページを全部)と文字列の数え上げ。5分で打ち切り。
- セキュリティ: 仕様の STRIDE のとおり。式を run に書かない。
- 運用: 印が付いたら、PR の本文に理由(なぜ消したか・なぜ飛ばしたか)があるかを人が見る。理由が無ければ `/rework`。誤って付く(テストを整理しただけ)ときも、理由を本文に書けばよい。
- 費用: Actions の分数がわずかに増える(PR の push ごとに1分未満)。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離 | 該当なし |
| 権限の表 | 該当なし |
| 監査ログ | 該当なし |
| 解約で消す一覧 | 該当なし |
| サポートの代理ログイン | 該当なし |
| ログの個人情報 | ファイルの名前と数だけを出す |
| 列の分類(`personal` / `sensitive`) | 該当なし |
| 画面の部品 | 該当なし |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 最重要 | 止めずに印・土台の物で流す・ラベルで「高」 |
| データモデル | 低優先 | 該当なし |
| API | 低優先 | GitHub を読むだけ |
| 状態遷移 | 軽く確認 | ラベルの付け外し |
| システム間連携 | 採用 | 権限・フォーク・labeler とのぶつかり |
| 業務ルール | 最重要 | 何を「弱めた」とみなすか |
| 要求との対応 | 機械で検証 | 単体テスト・`pnpm guards` |
| 非機能 | 軽く確認 | 短い |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- **落とさずにラベルを付ける** — 理由のある弱め方もある。gaps.md の案(印を付ける CI)のとおり。
- **ラベルを `risk:high` にせず `tests:weakened` を足し、`isHighRisk` が見る** — labeler の `sync-labels: true` が、パスに当たらない `risk:high` を外すため。
- **検査を黙らせる注釈も見る**(テストのファイルに限らない) — 「テストを通す」ために lint・型・Semgrep を黙らせるのも同じ弱め方。
- **期待値の書き換えは見ない** — 形では正しい直しと見分けられない。印が多すぎると人が見なくなる。
- **人の PR も同じに見る** — 弱め方は人も AI も同じ。AI の PR だけに絞る理由が無い。
- **設定は名前ごとに一覧へ足す** — 一覧の書き方は `*` を使えない(フックと labeler と CODEOWNERS をそろえるため)。設定を足したら一覧にも足す(手引きに書く)。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
