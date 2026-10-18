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
| Cognito | ふだんは**開発用ログイン**(メールだけ)。流れを確かめるときは**偽物の Cognito**(`packages/fake-cognito`) | `docker compose -f docker-compose.yml -f docker-compose.cognito.yml up --build -d` | 本物の画面(Managed Login)・MFA・確認メール。stg で人が確かめる([runbooks/cognito-login.md](../runbooks/cognito-login.md)) |
| SES(メール) | 本番と同じ Postfix が、SES の代わりに Mailpit へ渡す(http://localhost:8025) | `docker compose up` | 迷惑メールの判定・DKIM / SPF・サンドボックス・送信の上限 |
| S3・SQS・ElastiCache(入れるとき) | MinIO・ElasticMQ・Valkey のコンテナ | 入れるときに足す | 権限(IAM)・暗号化(KMS) |

## 手元では再現できないもの

IAM の権限・VPC やセキュリティグループの通信・KMS・WAF・CloudFront・Aurora の本当の切り替え・Cognito の本物の画面。

- 書き方の誤りは Terraform の静的な検査で見る(`terraform validate`・Trivy・`terraform.yml`)。
- 動いて初めて分かるものは stg で確かめる。stg で見つけたら、手元で再現できる形(テスト)にして残す。

## 偽物の Cognito

- 本物と同じ入口(`/oauth2/authorize`・`/oauth2/token`・`/.well-known/jwks.json`・`/logout`)。client_id・戻り先・PKCE・nonce・code の使い回しを、本物と同じく確かめる(甘くすると API 側の確かめ漏れに気づけない)。
- 画面はメールアドレスを選ぶだけ(パスワードは無い)。「メールアドレスは確認済み」を外すと、確認していない人として返す。
- 同じメールなら毎回同じ sub を返す(本物と同じく、人ごとに変わらない ID)。
- 使う所: API の単体・結合テスト(そのまま関数として呼ぶ)・E2E(`E2E_AUTH=cognito pnpm test:e2e`)・手で試す。
- URL は `http://fake-cognito.localhost:9231`。`*.localhost` はブラウザから見ると自分の PC で、API のコンテナからは compose の別名で同じ名前に届く(本物の Cognito も1つの URL で答えるので、それに合わせた)。
- **本番では使えない**: 発行元を変える `COGNITO_ISSUER` は、API の設定が local / test 以外では起動時に止める。
