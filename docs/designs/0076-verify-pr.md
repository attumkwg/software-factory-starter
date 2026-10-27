# 設計: PR の動作確認を AI に回し、「通った ≠ 確かめた」を2層で守る

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0076-verify-pr.md](../specs/0076-verify-pr.md)
> 状態: 下書き
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

PR のテンプレートに「🖱 動作確認」の欄を足し、スキル `/verify-pr` が欄を読んで `apps/web/e2e/verify/pr-<番号>.spec.ts`(コミットしない)を E2E の部品で書き、`pnpm verify:lint`(1層目)→ プレビューか手元に流す → 記録とトレースを疑って読む(2層目)→ OK の後に PR へ貼る。

```mermaid
flowchart LR
  B[PR の 🖱 動作確認] --> W[/verify-pr が手順を書く\nhelpers・ふだんの E2E]
  W --> L{pnpm verify:lint\n1層目}
  L -->|止まる| W
  L --> R[playwright.verify.config.ts\nverify-fixture が記録]
  R --> V{記録・トレースを読む\n2層目}
  V --> C[コメントの案 → OK → 貼る]
```

## 作業の前に読んだ物(ガイド)

- `apps/web/CLAUDE.md` のテスト(役割と名前で取る・大事な流れ5本程度)・`apps/web/playwright.config.ts`・`playwright.vrt.config.ts`(別の設定の型・`testIgnore`)・`apps/web/e2e/helpers.ts`
- `.github/pull_request_template.md`(欄の並び。本文を読む検査は「取り組み」だけ: `scripts/bets.mjs`)
- `docs/security.md` の AI-3(本文はデータ)・AI-6(本番の個人データを渡さない)
- `docs/guides/vrt.md`(手元の出力を `.gitignore`)・`docs/guides/acceptance.md`(`/accept` の AI の項目がこれを使う)
- `scripts/decisions-lib.mjs`(スクリプトとテストの型)

## 1. 設計方針

- 手順はコミットしない(ADR 0081)。何度も要る確認は別の PR でふだんの E2E へ。
- 2層: 1層目は文字の形で止める `scripts/verify-lint-lib.mjs`(依存なし)。2層目は `verify-fixture.ts` が取る記録とトレースを AI が読む(スキルの 5)。
- 流す設定は別ファイル `playwright.verify.config.ts`(ふだんの E2E・VRT と混ぜない)。ふだんの設定は `verify/**` を `testIgnore` に足す。
- 1層目のテストは `test:scripts` に入れる(CI で流れる)。手順そのものは CI で流さない(コミットしないので)。

## 2. データモデル

DB は使わない。`verify-fixture.ts` の記録(報告の添付 `verify-log`): `pageErrors`(画面のエラーの文)・`consoleErrors`(console のエラーの文)・`failedResponses`(`status`・`method`・`path`。問い合わせは残さない)。出力は `apps/web/test-results-verify/`(`.gitignore`)。

## 3. API

該当なし(アプリの API は変えない)。

- `pnpm verify:lint [ファイル…]`: 無指定なら `apps/web/e2e/verify/*.spec.ts`。問題は `ファイル:行 [形] 文`、あれば 1。
- `pnpm --filter @app/web verify [ファイル]`: `E2E_BASE_URL`(既定 http://localhost:8080)。
- `lintVerify(text)` → `[{ line, rule, message }]`(行の順)。

## 4. 状態遷移

仕様の第2部の「状態 × 操作」のとおり。書き直して流すのは2回まで(CLAUDE.md の CI の決まりと同じ数)。

## 5. システム間連携

- 流す先: PR のプレビュー環境(`preview.yml` が URL を貼る)か手元の docker compose。本番には流さない(スキルの決まり)。
- `gh pr view`(読む)・`gh pr comment`(OK の後だけ)。外へ出す操作は PR の「🚪 外へ出した物」に並ぶ。

## 6. 業務ルール

1層目(`verify-lint-lib.mjs`)の形と、止める文:

| 形 | 止める書き方 |
|---|---|
| エラーの放置 | `.catch(() => {})` などの握りつぶし・空の `catch`・`try` |
| API の直叩き | `page.request`・`context.request`・`request.get/post/…`・`fetch(`・`newContext(`。行か前の行に `// 準備:` があり、その行に `expect` が無ければ通す |
| 判定のすり替え | `route`・`routeFromHAR`・`evaluate` の類・`addInitScript`・定数の `expect`・`expect.soft` |
| 不適切な操作 | `force: true` |
| 非同期の偽陽性 | `waitForTimeout` |
| 確認を飛ばす | `test.skip/fixme/fail/only`・`describe.only` |
| 記録が取れない | ファイルに `verify-fixture` が無い |
| アサーション無し | 確認(`test(`。`test.step`・`test.describe` は数えない)に `expect` が0・最後の操作の後に0 |
| 操作の前から合格 | 操作のある確認で、最後の操作の前に `expect` が0 |
| うわべの確認 | 判定が全部「有る・見える・押せる」だけ(`toBeVisible` など10種) |

- 注釈(行の `//` の後ろ。URL の `//` は除く)の中の言葉では止めない。
- 操作 = `click`・`dblclick`・`fill`・`press`・`pressSequentially`・`check`・`uncheck`・`selectOption`・`setInputFiles`・`dragTo`・`tap`。`goto` は操作に数えない(見るだけの確認を止めない)。
- `verify-fixture.ts`: 画面のエラーと 5xx は落とす。console のエラーと 4xx は記録だけ(権限の確かめで 403・404 が正しいことがある)。

2層目は `docs/guides/verify-pr.md` の 1 の表とスキルの 5(6つを1本ずつ)。

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| テンプレートに「🖱 動作確認」 | `.github/pull_request_template.md` | 目で(テンプレートは検査しない) |
| 欄を読んで確かめ、コメントの案(貼るのは OK の後) | `.claude/skills/verify-pr/SKILL.md` の 1〜6 | スキルの手順(機械では確かめない) |
| 危ない書き方は流す前に止まる | 6・`scripts/verify-lint-lib.mjs` | `scripts/verify-lint.test.mjs`(9件) |
| 画面のエラー・5xx は通っても落ちる | 2・6・`apps/web/e2e/verify-fixture.ts` | 型だけ(`pnpm --filter @app/web typecheck`)。動きは初回の `/verify-pr` で確かめる(手元で E2E を流していない) |
| 2層目の結果がコメントに残る | スキルの 5・6 | スキルの手順 |

## 8. 非機能

- 性能: lint はファイルを読むだけ。流すのは1本ずつ(workers 1)・再試行なし。
- セキュリティ: 仕様の STRIDE のとおり。記録に URL の問い合わせを残さない。console のエラーの文はそのまま残るので、種データ以外で流さない。
- 運用: 1層目で同じ形が2層目で2回見つかったら lint に足す(ADR 0081 の見直す合図)。
- 費用: プレビュー環境に流す時間だけ。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離 | 確認の中で他社 404 を確かめてよい。アプリは変えない |
| 権限の表 | 該当なし |
| 監査ログ | 該当なし(確認の書き込みはプレビューか手元の監査ログに残るだけ) |
| 解約で消す一覧 | 該当なし |
| サポートの代理ログイン | 該当なし |
| ログの個人情報 | 記録に問い合わせを残さない・種データだけ |
| 列の分類(`personal` / `sensitive`) | 該当なし |
| 画面の部品 | 該当なし(要素は役割と名前で取る) |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 最重要 | 手順をコミットしない・2層(U-1・ADR 0081) |
| データモデル | 低優先 | 記録の形だけ |
| API | 低優先 | アプリの API は変えない |
| 状態遷移 | 軽く確認 | 2回まで |
| システム間連携 | 採用 | 流す先とコメントの OK |
| 業務ルール | 採用 | 1層目の形の線引き(止めすぎ・すり抜け) |
| 要求との対応 | 機械で検証 | `scripts/verify-lint.test.mjs`。fixture の動きは未確認(7) |
| 非機能 | 軽く確認 | 1本ずつ・問い合わせを残さない |
| CI の設定(PR のテンプレート) | 最重要 | `.github` は危険度「高」(U-2) |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- 1層目は依存なしの文字の形で見る(AST を使わない) — Biome の独自の決まりは手元の版で書けず、TypeScript の解析を足すと重い。すり抜けは2層目が拾う。
- `goto` を操作に数えない — 見るだけの確認(一覧に出る)まで「操作の前の expect」を求めると、意味の無い判定を足させる。
- 4xx は落とさない — 権限の確認で 403・404 が正しい。
- 準備の印の行に `expect` があれば止める — 準備に見せて確かめを API でする抜け道を塞ぐ。
- 出力の置き場を `test-results-verify/` に分ける — ふだんの E2E の報告と混ぜない(VRT と同じ)。
- `/accept` の AI の項目は同じ手順で流す — 2つの書き方を作らない。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|
| U-1 | 設計 | 事業判断 | 手順はコミットせずに PR のコメントへ貼る(ADR 0081)。何度も要る確認は別の PR でふだんの E2E に | ふだんの E2E を絞ったままにし、製品の知識の源を濁さない | コミットしない形でよいか(確かめた手順をリポジトリに残したいか) | 仮決め |
| U-2 | 設計 | 戻せないリスク | PR のテンプレート(`.github`。危険度「高」)に「🖱 動作確認」の欄を足す。既定は「- なし」 | 欄が無いと AI が何を確かめるかが決まらない。既定を「なし」にして画面を変えない PR の手間を増やさない | テンプレートに欄を足してよいか | 仮決め |

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
| 2026-10-27 | 書きながら、`page.request` の通信は context の出来事に出ないと分かった | 設計 | API の直叩きは記録で見ず、1層目と2層目(トレース)で見る | `verify-fixture.ts`・手引きの表 |
