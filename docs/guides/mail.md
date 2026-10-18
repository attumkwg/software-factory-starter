# メールの送り方

> 決めた理由は [ADR 0008](../adr/0008-mail-via-postfix.md)。最初の使い道は [specs/0002](../specs/0002-task-completed-mail.md)。困ったときは [runbooks/mail-not-delivered.md](../runbooks/mail-not-delivered.md)。

## 道すじ

```
本番: API ─(アウトボックス)→ Postfix(ECS・送り待ちは EFS)─ SMTP+TLS → SES → 相手
手元: API ─(アウトボックス)→ Postfix(docker compose)────────────→ Mailpit(http://localhost:8025)
Cognito の確認コード・再設定: Cognito → SES(Postfix は通さない)。手元では偽物の Cognito
```

- **アプリは SMTP でしか送らない**(SES の SDK を直接呼ばない)。手元と本番で違うのは Postfix の「渡す先」だけ。
- **必ずアウトボックス経由で送る**。同じトランザクションで出来事を積み、送り出しが Postfix に渡す。渡せなければやり直す(1秒・2秒・4秒…最大1時間)。Postfix が受け取った後は、Postfix が SES に渡すまでやり直す(最大5日)。送り待ちは EFS にあるので、Postfix が入れ替わっても消えない。
- **まれに2通届く**(アウトボックスは「少なくとも1回」)。同じ出来事から作ったメールは同じ Message-ID にしてある。

## メールを足す手順

1. 仕様を書く(`docs/specs/`)。宛先・送らない場合・本文・悪用のされ方。
2. 出来事が無ければ足す(`apps/api/src/outbox/topics.ts`。中身は ID だけ。メールアドレスや本文は入れない)。
3. 宛先と本文を作る関数を、その出来事の領域に書く(例: `domains/tasks/notifications.ts`)。
   - 宛先・名前は**送る直前に** DB から読む(消された人に送らない)。テナントの文脈(`withTenant`)の中で読む。
   - 送らない場合は `{ skip: "理由" }` を返す(ログに理由が残る)。
   - 件名・本文に、利用者が書いた値をそのまま入れてよい(件名は `mailer.ts` が1行にそろえる)。HTML のメールにするときは、値を必ずエスケープする。
4. 受け手(`apps/api/src/outbox/handlers.ts`)で、組み立てて `mailer.send()`。DB のトランザクションの外で送る。
5. テスト: 結合(`test/integration/mail.int.test.ts` の形。Mailpit まで届くか・送らない場合)。大事な流れなら E2E(`e2e/mail.spec.ts`)。

## 手元で見る

- `docker compose up --build` のあと、http://localhost:8025 に届いたメールが全部並ぶ(外には出ない)。
- ホストで API を動かす(`pnpm dev`)ときは、`.env` に `MAIL_SMTP_URL=smtp://localhost:2525`(compose の Postfix)。無ければ送らずにログに記録だけ。
- Postfix の送り待ちを見る: `docker compose exec postfix postqueue -c /run/postfix/conf -p`

## 本番の準備(人がやる。1回だけ)

1. **SES の「本番のアクセス」を申し込む**(SES のコンソール → アカウントのダッシュボード)。最初は「サンドボックス」で、確かめたアドレスにしか送れない。申し込みには、送るメールの種類・数・戻ってきたメールの扱いを書く。stg はサンドボックスのままでもよい(テストに使うアドレスを確かめておく)。
2. `terraform apply` で、SES のドメイン・DKIM・SPF・DMARC・SMTP の資格情報・Postfix(EFS)ができる。DKIM の確認は数分〜72時間。
3. Postfix のイメージを出す: Actions → **Deploy mail relay** → Run workflow(GitHub の変数 `MAIL_ECR_REPOSITORY_URL` に stg の出力 `mail_ecr_repository_url`)。
4. 届くかを確かめる: stg でタスクを完了にし、作った人に届くこと。迷惑メールに入っていないこと(DKIM と SPF が pass か、メールのヘッダーで見る)。

## 費用(環境ごと・月)

| もの | 費用 |
|---|---|
| Postfix(Fargate 0.25 vCPU・0.5GB・1台) | 約1,700円 |
| EFS(送り待ち。数 MB) | 数十円 |
| SES | 1,000通あたり 約15円 |

## 入れ替え・見直し

- **SMTP の資格情報の入れ替え**(年1回・漏れた疑いがあれば即): `terraform apply -replace=module.ses.aws_iam_access_key.smtp` → Postfix を入れ替える(Deploy mail relay をもう一度流す)。
- **DMARC**: 最初は `p=none`(数えるだけ)。数週間、DKIM と SPF が pass しているのを見てから `quarantine` → `reject`。
- **知らせの数が増えたら**: 宛先ごとにまとめて1通にする・受け取らない設定を足す(spec 0002 の「やらないこと」)。
