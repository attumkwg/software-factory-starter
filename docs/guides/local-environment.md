# 手元で AWS をどこまで再現するか

> 決まり: **アプリは AWS の SDK を直接呼ばず、どこにでもある取り決め越しに話す**(認証は OIDC、メールは SMTP、ファイルは S3 互換、DB は Postgres)。
> そうすると手元の代わりは「AWS のまね」ではなく、ふつうのサーバー(コンテナ)で済み、本物との違いが小さくなる。
> AWS をまねる道具(LocalStack など)は最後の手段。Cognito を使うには有料版が要り、まねの細かい違いで迷う。

## 部品ごとの代わり

| AWS の部品 | 手元の代わり | 動かし方 | 本物との違い(手元で確かめられないこと) |
|---|---|---|---|
| ALB | Caddy(`/api/*` を API へ・それ以外を画面へ) | `docker compose up` | 証明書・WAF・ヘッダーの細かい扱い |
| ECS Fargate・Service Connect | docker compose(同じイメージ・サービス名で呼ぶ) | 同上 | タスクの入れ替え・ヘルスチェックの間隔 |
| Aurora PostgreSQL | postgres:17 のコンテナ | 同上(テストは Testcontainers) | 本物の切り替え(フェイルオーバー)。手元はコンテナの再起動で代える |
| Secrets Manager | compose の環境変数(手元専用の値) | 同上 | 秘密の取り出しの権限(IAM) |
| CloudWatch Logs | 標準出力の JSON | `docker compose logs api` | Logs Insights での探し方 |
| Cognito | ふだんは**開発用ログイン**(メールだけ)。登録・ログイン・二段階認証・再設定を確かめるときは**偽物の Cognito**(`packages/fake-cognito`)。確認コードのメールは Postfix → Mailpit | `docker compose -f docker-compose.yml -f docker-compose.cognito.yml up --build -d` | SES から届くか・迷惑メールの判定。偽物とのずれは**契約テスト**を stg の本物に流して確かめる(いまは手動。有効にすると週1回) |
| SES(メール) | 本番と同じ Postfix が、SES の代わりに Mailpit へ渡す(http://localhost:8025) | `docker compose up` | 迷惑メールの判定・DKIM / SPF・サンドボックス・送信の上限 |
| KMS(要配慮個人情報のデータ鍵を包む。ADR 0029) | コードに書いた包み鍵(`apps/api/src/sensitive/key-wrapper.ts` の `localKeyWrapper`。秘密ではない)。`SENSITIVE_KMS_KEY_ID` を入れない | `docker compose up`(`SENSITIVE_DATABASE_URL` は compose にある) | 鍵のポリシー・文脈の条件・CloudTrail の記録・鍵の利用のアラーム。stg・prod では手元の包み鍵で起動しない(`config.ts`)。KMS への渡し方は単体テストが偽物の KMS で確かめる |
| S3・SQS・ElastiCache(入れるとき) | MinIO・ElasticMQ・Valkey のコンテナ | 入れるときに足す | 権限(IAM)・暗号化(KMS) |

## 手元では再現できないもの

IAM の権限・VPC やセキュリティグループの通信・KMS・WAF・CloudFront・Aurora の本当の切り替え・Cognito の本物の画面。

- 書き方の誤りは Terraform の静的な検査で見る(`terraform validate`・Trivy・`terraform.yml`)。
- 動いて初めて分かるものは stg で確かめる。stg で見つけたら、手元で再現できる形(テスト)にして残す。

## 偽物の Cognito と契約テスト

- 本物と同じ取り決め(JSON 1.1・`x-amz-target`)で答える。**アプリが使う入口だけ**: 登録・確認コード・ログイン(USER_PASSWORD_AUTH)・二段階認証(TOTP)・再設定、と契約テストが使う管理の入口(人を確認済みにする・消す・設定を読む)。
- 本物と同じく断る: パスワードの決まり・違う / 切れたコード・「その人はいない」と言わない・続けて間違えると止める。甘くすると、アプリ側の確かめ漏れに気づけない。
- 設定(パスワードの決まり・確認コードのメールの文面)は `packages/shared/src/cognito-settings.json`。Terraform も同じ物を読む。
- 確認コードのメールは、手元では Postfix → Mailpit(http://localhost:8025)。テストからは `fake.lastCode(email)` でも読める。
- 使う所: API の単体・結合テスト(関数として呼ぶ)・E2E(`E2E_AUTH=cognito pnpm test:e2e`)・手で試す。
- **本番では使えない**: 入口を変える `COGNITO_ENDPOINT` は、API の設定が local / test 以外では起動時に止める。

### 契約テスト(偽物が本物とずれていないか)

`packages/fake-cognito/contract/` に、**偽物と本物の両方に流す1組のテスト**がある(AWS 公式の SDK でつなぐ)。

| どこに | いつ | 回し方 |
|---|---|---|
| 偽物 | PR ごと(CI の単体) | `pnpm test` |
| stg の本物 | Cognito の設定を変えて apply したとき(いまは手動。有効にすると週1回 月曜 9:00。[automation.md](automation.md)) | Actions → **Cognito contract**(`cognito-contract.yml`)。落ちたら Issue が立つ |
| 手元から stg の本物 | 気になったとき | `COGNITO_CONTRACT_TARGET=real COGNITO_USER_POOL_ID=… COGNITO_CLIENT_ID=… pnpm --filter @app/fake-cognito test:contract`(stg の資格情報で) |

**本物で落ちたとき**: どのテストが落ちたかを見て、本物の振る舞いに合わせて偽物(入口ごとの答えは `src/actions/`・人やトークンの中身は `src/pool.ts`)を直す → 偽物でも同じテストが通ることを確かめる → アプリ(`apps/api/src/auth`)がその振る舞いに頼っていれば、アプリも直す。**テストを本物に合わせて書き換えるのは、本物の振る舞いが正しいと確かめてから**。

**アプリが Cognito の新しい振る舞いに頼るとき**(新しい入口・新しい失敗の種類): 先に契約テストに足し、本物で通ることを確かめてから、偽物とアプリを書く。
