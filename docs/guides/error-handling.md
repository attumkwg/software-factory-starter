# 例外処理(失敗の扱い)の決まり

> 失敗したときに **「利用者には次にやることを」「ログには原因を(値は出さずに)」「プロセスは落とさずに」**。
> API と画面の両方で、失敗は1か所で受け止める。新しい API や画面を足すときも、この形に乗せれば決まりが守られる。

## 1. 失敗の種類(code)

API の失敗は必ず `{ error: { code, message, requestId } }` の形で返す。**画面・スマホは code で分岐する**(message は人が読む説明で、変わりうる)。一覧は `packages/shared/src/schemas.ts` の `ERROR_CODES`。足すのはよいが、消す・意味を変えるのはしない(古い画面が残るため)。

| code | status | いつ | 画面がすること |
|---|---|---|---|
| `bad_request` | 400 | 入力が正しくない・JSON が壊れている | 「入力を確かめてください」 |
| `unauthorized` | 401 | ログインしていない・切れた | ログイン画面へ |
| `login_failed` | 401 | ログインできなかった | 「メールアドレスを確かめてください」 |
| `forbidden` | 403 | 権限が無い | 知らせて、画面を読み直す |
| `not_found` | 404 | 無い・他社の物・ほかの人が消した | 知らせて、画面を読み直す |
| `conflict` | 409 | 同時の変更とぶつかった(親が消された・一意の制約) | 知らせて、画面を読み直す |
| `payload_too_large` | 413 | 本文が 1MB を超える | 「短くしてください」 |
| `unsupported_media_type` | 415 | 本文が JSON ではない | (画面からは起きない) |
| `service_unavailable` | 503 | DB の再起動・切り替え・時間切れ・接続の上限。`Retry-After` 付き | 「少し待ってから」 |
| `internal` | 500 | それ以外の想定外(こちらのバグ) | 「時間をおいて」+問い合わせ番号 |

## 2. API(apps/api)

- **失敗は投げるだけ**。ルートで try/catch して形を作らない。`app.ts` の `onError` が `errors.ts` の `toApiError` で code に直す。
  - 決まった失敗は `errors.ts` の関数(`notFound()` など)を投げる。
  - DB の失敗は SQLSTATE で振り分け済み(待てば通る → 503、読み直せば通る → 409、それ以外 → 500)。新しい制約を足して、その違反を利用者に伝えたいときは `errors.ts` に足す。
- **ログ**: 5xx は `error`、409 は `warn`、ほかの 4xx は残さない(アクセスログに status が出る)。
  - 失敗は `logger.error({ err }, "…")` の形で渡す。`err` は `serializeError` を通り、**SQL のパラメータ・DB の detail(値が入る)を落とす**。`err.message` を自分で文字列にしてログに入れない(落とせなくなる)。
- **プロセスを落とさない**: DB の接続が切れても(`pool.on("error")`)、記録だけして次の接続を作る。DB に届かないときは5秒で諦めて 503。
- **落とすべきときは落とす**: どこにも受け止められなかった失敗(`uncaughtException` / `unhandledRejection`)は、状態が壊れているかもしれないので JSON で1行残して止まる。ECS が新しいタスクを立てる。
- **外の仕組み(Cognito など)に届かない**のは、「利用者が間違えた(401)」と混ぜずに 503 にする。混ぜると障害に気づけない。

## 3. 画面(apps/web)

- **読む失敗**(route の loader): 投げるだけ。`router.tsx` の `defaultErrorComponent`(`pages/ErrorPages.tsx`)が受け止め、理由・問い合わせ番号・「もう一度読み込む」を出す。無い物は `notFound()` を投げる(404 の画面)。
- **書く失敗**: 必ず `useAction`(`src/use-action.ts`)を通す。Semgrep の `web-writes-through-use-action` が、通していない書き込みを止める。
  - 成功 → 画面を読み直す → トースト / 失敗 → フォームなら入力の下に、それ以外はトースト / 401 → ログイン画面へ / 実行中 → ボタンを押せない(二重に送らない)
- **文は `src/errors.ts` の `describeError`** で code から決める。API の message(英語の検証の文など)をそのまま出さない。
- **SSR の失敗**: 画面のサーバーから API に届かない・5xx は、画面のサーバーのログに `requestId` つきで1行残る(API のログと突き合わせられる)。SSR からの呼び出しは10秒、ブラウザからは15秒で打ち切る。
- **失敗の種類をブラウザへ渡す**: SSR で起きた `HttpError` / `NetworkError` は `src/start.ts` の変換でブラウザでも同じ種類になる。新しい種類の失敗クラスを作ったら、ここに足す(足さないと、サーバーとブラウザで画面の文がずれる)。

## 4. 確かめる仕組み

| 何を | どこで |
|---|---|
| DB の失敗の振り分け・ログに値が出ない・接続が切れても落ちない・本文の失敗の code | `apps/api/test/unit/errors.test.ts` |
| 画面の文(code ごと・通信の失敗・SSR とブラウザの違い) | `apps/web/src/errors.test.ts` |
| 書き込みに失敗したら入力を残して理由を出す・ログインが切れたらログイン画面へ・読み込みの失敗から戻れる | `apps/web/e2e/errors.spec.ts` |
| 書き込みが useAction を通っている | Semgrep `web-writes-through-use-action` |

## 5. まだやっていないこと

- 失敗を **Sentry に送る**(監視の基本で入れる)。いまは JSON のログと Logs Insights だけ。
- **書き込みの自動のやり直し**はしない(二重に作られる)。やり直すなら、API に冪等キー(Idempotency-Key)を入れてから。
