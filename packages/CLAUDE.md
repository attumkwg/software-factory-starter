# packages のルール

> 全体のルールはルートの `CLAUDE.md`。

- `packages/shared` … 画面と API の契約(Zod)・お金と時刻の計算(`money.ts`・`time.ts`)。**項目は足すだけ・消さない**(CI の「API の互換」が見張る)。
- `packages/logging` … API と画面のサーバーのログの部品。**出してよい項目だけ出す**(許可リスト。知らない名前は `[REDACTED]`)。ログに新しい名前を出すなら `ALLOWED_KEYS` に足す(人の確認。危険度「高」)。ADR 0019。
- `packages/error-reporting` … error 以上のログを Sentry に送る(値を落としてから)。Sentry を直接呼ばず、`logger.error({ err }, "…")` で残す。`docs/guides/monitoring.md`。危険度「高」。
- `packages/fake-cognito` … 開発とテスト専用の偽物の Cognito と、本物と比べる契約テスト(`contract/`)。**偽物の振る舞いを変えたら契約テストも直す**。手元の AWS の代わりの一覧は `docs/guides/local-environment.md`。
- `packages/ui` … デザインシステム(React Aria の部品とトークン)。色の正は `src/tokens.css`(比は `pnpm contrast`)。部品の一覧と使い方は `docs/design-system.md`。
