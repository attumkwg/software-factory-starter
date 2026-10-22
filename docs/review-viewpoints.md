# 設計とレビューの観点(溜めていく台帳)

> 設計書(`docs/designs/`)はこの観点の順に書き、レビュー(`/review-pr`)はこの観点ごとに「扱い」を付ける。扱いの5つと使い方は [guides/human-review.md](guides/human-review.md)。
> **人がレビューで「これも見るべきだった」と気づいたら、ここに1行足す。** 足した観点は次から AI が見る。機械で確かめられるようになったら「機械で確かめている所」に書き足す。

## 共通の8つ

| # | 観点 | 何を見るか | 機械で確かめている所 | 人に聞く(4つ)に当たりやすい所 |
|---|---|---|---|---|
| 1 | 設計方針 | 既存の ADR・領域の境目に沿っているか。新しい部品や依存を足していないか | `domain-boundaries.test.ts`(領域の向き・輪) | 新しい外部サービス(契約)・ADR を覆す判断 |
| 2 | データモデル | 表・列・参照・索引。お金と時刻の型。消す・移す | squawk(移行)・`rls.int.test.ts`・`offboarding.int.test.ts`・Semgrep(`no-float-money`・`no-local-time`) | 列を消す・型を変える(戻せない)・持つ個人データ |
| 3 | API | 入力と出力の形・失敗の応答・互換 | `api-compat`(oasdiff)・`input-validation.int.test.ts` | 公開した形を変える(戻せない)・他チームが呼ぶ API |
| 4 | 状態遷移 | 状態の種類と、移ってよい向き・戻せるか | (領域ごとのテスト) | 利用者に見える状態の意味(利用者の挙動) |
| 5 | システム間連携 | アウトボックス・メール・Cognito・Sentry など外との出入り | `outbox.int.test.ts`・`mail.int.test.ts`・偽物の Cognito の契約テスト | 外へ送る物(戻せない)・外部の制約(契約) |
| 6 | 業務ルール | 受け入れ条件の決まり・境界値・誰が何をできるか | 権限の表のテスト・領域のテスト | 決まりの線引き(事業判断) |
| 7 | 要求との対応 | 受け入れ条件の1つずつに、設計とテストがあるか。仕様に無い振る舞いを足していないか | (設計書の「要求との対応」の表で突き合わせる) | 仕様に無い判断(事業判断) |
| 8 | 非機能 | 性能(N+1・件数が増えたとき)・セキュリティ(STRIDE)・運用(ログ・アラーム・手順書)・費用 | Semgrep・Trivy・gitleaks・ZAP・`logger.test.ts` | 費用が増える(事業判断)・秘密や個人データ(戻せない) |

## このプロダクト特有(マルチテナントの TODO アプリ)

| 観点 | 何を見るか | 機械で確かめている所 | 足した日・きっかけ |
|---|---|---|---|
| テナント分離 | テナントはセッションからだけ。`c.var.tx` と `tenantId` の絞り込み。他社は 404 | `tenant-isolation.int.test.ts`・`rls.int.test.ts`・Semgrep の自社ルール | 最初から |
| 権限の表 | 新しい API が `policy.ts` と `matrix.yaml` の両方にあるか。誰に何を許したか | `authz-coverage.test.ts`・`default-deny.test.ts`・`authz-matrix.int.test.ts` | 最初から |
| 監査ログ | 書き込みの API に名前があるか。一度使った名前を変えていないか | `audit-coverage.test.ts`・`audit.int.test.ts` | 2026-10(監査ログ) |
| 解約で消す一覧 | `tenant_id` の表を足したら `TENANT_TABLES` と書き出しにも | `offboarding.int.test.ts` | 2026-10(解約) |
| サポートの代理ログイン | 代理の社員に書き込みを許していないか | `support-access.int.test.ts`・`support.test.ts` | 2026-10(代理ログイン) |
| 一覧のページングと索引 | 一覧が全件を返していないか(`cursor`・`limit`・`nextCursor`)。並びと同じ索引があるか。すでにある表の索引は `drizzle/concurrent/` で | `performance.int.test.ts`(上限・最後まで読める・実行計画に Sort が無い)・squawk | 2026-10(速さの点検) |
| ログの個人情報 | オブジェクトを丸ごと・メール・名前・トークンを渡していないか。分類表で `personal` / `sensitive` の値を、ログ・監査ログの `details`・出来事の中身に入れていないか | ログの部品の許可リスト(`packages/logging`)・Semgrep(丸ごと・広げる・個人情報の名前・文への埋め込み)・`personal-data-logs.int.test.ts`(全 API を目印で叩く)・`classification.test.ts` | 最初から |
| 列の分類(個人情報の台帳) | 足した列に区分と目的があるか。自由な文が `internal` になっていないか。`sensitive` はスキーマ `sensitive` だけ(ADR 0018) | `classification.test.ts`・`classification.int.test.ts`(DB の全部の列) | 2026-10(3回目の点検) |
| 画面の部品 | `@app/ui` の部品だけを使っているか | (目で見る) | 最初から |

## 隠す物(人に出さない)

- 標準の作り(一覧・登録・更新・削除が既存の型どおり)
- 調べれば分かること(既存のコード・用語集・ADR に書いてあること)
- 上の「機械で確かめている所」で落ちる物(テストが緑なら人は見ない)

最終更新: 2026-10-20(共通の8つと、このプロダクト特有の7つで始めた。同日、一覧のページングと索引を足した)
