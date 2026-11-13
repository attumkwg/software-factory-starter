# 設計: 使いやすさを確かめるテスト(初見の利用者テストと、機械で見る3つの決まり)

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人に判断してほしい所」だけを読む。
> 仕様: [docs/specs/0100-usability-test.md](../specs/0100-usability-test.md)
> 状態: 完了
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし」と書く。

## 0. 全体像

- 操作の道具 `apps/web/e2e/usability/`(`browse.ts` 呼び口・`server.ts` ブラウザを持ち続ける・`browse-lib.ts` 判定)と `pnpm ux:browse`
- 利用者役 `.claude/agents/first-time-user.md`・回し方 `.claude/skills/usability-test/SKILL.md`・頼む仕事 `docs/ux/usability-tasks.yaml`・記録 `docs/ux/usability/`
- 機械の検査: `apps/web/src/ux-rules.test.ts`(戻せない操作を直に呼ぶ・空の文の無い表・設定のカードの主ボタン)・`apps/web/e2e/ux-rules.spec.ts`(1画面の主ボタンの数)

## 作業の前に読んだ物(ガイド)

- `docs/guides/ux-review.md`・`docs/ux/2026-11-14-all-screens.md`(🎨 の棚卸し)・`docs/product/personas.md`
- `.github/scripts/start-app.sh`・`docker-compose.vrt.yml`・`apps/web/playwright.config.ts`・`apps/web/playwright.verify.config.ts`・`docs/guides/verify-pr.md`
- `@playwright/mcp` の README(設定・`remoteEndpoint`・同梱の Playwright の版)

## 1. 設計方針

- ブラウザは E2E・VRT と同じ Docker の中の Chromium に、キットの Playwright(`@playwright/test`)でつなぐ。版は `e2e/vrt/versions.test.ts` がそろえている3か所のまま(増やさない)。
- 利用者役は「見える物だけ」: 操作は役割と名前(`getByRole`)とラベル(`getByLabel`)だけ。返すのは aria の木と画像。
- 数は道具が取る(1手1行の記録)。利用者役は言葉を返す。
- 機械の検査はラチェット(今の外れを理由つきで並べ、増えたら落ちる・直したら消さないと落ちる)。

## 2. データモデル

- 該当なし(DB は触らない)。記録は一時フォルダの `steps.jsonl`(`{ at, url, action, args, ok, error? }`)と `shot-NN.png`。

## 3. API

- 該当なし(アプリの API は変えない)。道具の呼び口:

| 呼び方 | 何をするか |
|---|---|
| `pnpm ux:browse serve [mobile\|desktop]` | Pixel 7(タッチ)か Desktop Chrome の形でブラウザを持ち続ける。127.0.0.1 の空いた番号で待つ。終わるまで戻らない(裏で動かす) |
| `look` | 画面の題・道・画像の場所・body の aria の木 |
| `tap <役割> <名前>` | タッチならタップ・パソコンならクリック。チェックはラベルを押す |
| `fill <ラベル> <文字>`・`select <ラベル> <選ぶ物>`・`press <キー>`・`goto <道>`・`back` | 入れる・選ぶ・キー・移る(同じ origin だけ)・戻る |
| `report` | 手数・うまくいかなかった手・戻った数・見た画面 |
| `stop` | 閉じる |

- 立てるのを裏の子のプロセスにしなかった理由: Windows では、子が親の出力の管(パイプ)を受け継ぎ、`| grep` などで呼んだときに戻らなくなった。立てる側(`/usability-test`)が裏で動かす形にした。

## 4. 状態遷移

- 道具: 立っていない →(serve)→ 立っている →(stop)→ 立っていない。立っていないときの操作は「立っていません」で終わる。

## 5. システム間連携

- Docker の中の Chromium(`ws://127.0.0.1:3100/`。`E2E_WS_ENDPOINT` で変えられる)。`exposeNetwork: "<loopback>"` で手元のアプリに届く
- 利用者役は Agent(subagent_type `first-time-user`)。Bash で `pnpm ux:browse` だけを使い、Read で画像だけを読む

## 6. 業務ルール

- 利用者役に渡すのはペルソナ・頼む仕事・してよい操作・手数の上限・ログインのメールだけ
- 合格は呼ぶ側が確かめる。「できなかった」は E2E の部品で再現してから不具合と呼ぶ
- 機械の検査の外れの一覧(KNOWN)は、G-164 で直したら消す

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 道具で操作でき、記録が残り、外へは行けない | 3・`apps/web/e2e/usability/` | `apps/web/e2e/usability/browse-lib.test.ts`(行き先・記録のまとめ・呼び口) |
| 利用者役・回し方・頼む仕事がある | 0 | (手で確かめる: AI の手順なのでテストにできない。仕事を回して記録を残した) |
| 一度回した記録がある | `docs/ux/usability/` | (手で確かめる: 記録の文書。読んで確かめた) |
| 戻せない操作・空の文・設定のカードの主ボタンが増えると落ちる | 1・6 | `apps/web/src/ux-rules.test.ts` |
| 主ボタンが2つ以上の画面があると落ちる | 1 | `apps/web/e2e/ux-rules.spec.ts` |

## 8. 非機能

- 費用: 利用者テストは手で回す(仕事1つで AI の呼び出し1回+数十手)。CI では回さない。機械の検査は単体テスト1本・E2E 1本(約10秒)
- セキュリティ: 待ち受けは 127.0.0.1 だけ・行き先は同じ origin だけ・種データの利用者だけ
- 運用: 記録は一時フォルダ。残す物は `docs/ux/usability/` に人が読める形で書く

## 9. このプロダクト特有

- 頼む仕事(U-1〜U-4)は、このプロダクトのペルソナ(P-1・P-2・P-3・P-5)と種データ(Acme)に合わせた。題材を差し替えたら書き直す

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 最重要 | E2E と同じブラウザ・同じ Playwright。版を増やさない |
| 要求との対応 | 機械で検証 | 道具の判定と3つの決まりはテスト。AI の手順は回して記録を残した |
| 非機能 | 採用 | 待ち受けと行き先を絞った(セキュリティ)。CI では回さない(費用) |
| 画面の状態・見た目の強弱・危ない操作と戻し方 | 機械で検証 | 3つの決まりをテストにした(台帳の「機械で確かめている所」に書いた) |
| データモデル・API・状態遷移・業務ルール | 低優先 | アプリの振る舞いを変えない |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- 操作の道具はキットの Playwright で作る — Playwright MCP は同梱の版(0.0.84 で 1.65 の alpha)が Docker の Chromium(1.64)とずれる。MCP に合わせると版を5か所目でそろえることになる
- 危ない操作はコードから見る — E2E で押すと種データが変わり、ほかのテスト(メール・タスク)を壊す
- 主ボタンの数は E2E、設定のカードはコード — 種データでは設定のカードの機能が出ないので、E2E の数えでは拾えない
- 外れはラチェットで始める — 直してから入れると検査が遅れる

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|
| (なし) | | | | | | |

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
