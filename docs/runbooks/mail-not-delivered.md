# 手順書: メールが届かない

> 道すじ: API ─(アウトボックス)→ Postfix(送り待ちは EFS)→ SES → 相手。どこで止まっているかを、手前から順に見る。

## 1. アプリは積んだか・Postfix に渡したか(アウトボックス)

```
fields @timestamp, eventId, reason, messageId, message
| filter service = "api" and message like /メール/
| sort @timestamp desc
```

| ログ | 意味 | どうするか |
|---|---|---|
| `メールは送りません`・`reason` | 送らない決まりに当たった(自分で完了にした・未完了に戻した・消された) | 仕様どおり。`reason` を確かめる |
| `メールを渡しました` | Postfix が受け取った | 2. へ |
| 何も無い・送り出しの失敗が続く | Postfix に届いていない | アウトボックスの表で `attempts` と `last_error` を見る。Postfix のサービスが動いているか・セキュリティグループ |

```sql
-- 渡せずに溜まっている出来事(表の持ち主で)
SELECT topic, attempts, available_at, dead_at, last_error FROM platform.outbox
WHERE sent_at IS NULL ORDER BY created_at DESC LIMIT 50;
```

## 2. Postfix は SES に渡したか

CloudWatch Logs の `/ecs/<名前>-mail`(Postfix のログ)。

```
fields @timestamp, @message
| filter @message like /status=/
| sort @timestamp desc
```

| ログ | 意味 | どうするか |
|---|---|---|
| `status=sent (250 Ok ...)` | SES が受け取った | 3. へ |
| `status=deferred` | SES に渡せず、送り待ちに残っている(やり直す) | 理由を読む。`Message rejected: Email address is not verified` はサンドボックス(guides/mail.md の「本番の準備」)。`Throttling` は SES の送信の上限 |
| `status=bounced` | SES か相手が断った(やり直さない) | 宛先の誤り・相手の受信箱がいっぱい など |
| `SASL authentication failed` | SMTP の資格情報が違う・消えた | 資格情報を入れ替える(guides/mail.md) |
| `TLS is required, but was not offered` | SES に TLS でつながらない | NAT・セキュリティグループ(587 の出口) |

## 3. SES は相手に届けたか

- SES のコンソールの「送信の統計」で、戻ってきた(bounce)・迷惑メールの報告(complaint)の割合を見る。割合が高いと SES が送信を止める。
- 迷惑メールに入る: 受け取ったメールのヘッダーで `dkim=pass` と `spf=pass` を見る。fail なら DNS のレコード(`modules/ses-domain`)。

## 手元で再現する

- Mailpit を止めて送ると、Postfix の送り待ちに残る: `docker compose stop mailpit` → タスクを完了にする → `docker compose exec postfix postqueue -c /run/postfix/conf -p`
- Postfix を作り直しても残る: `docker compose up -d --force-recreate postfix` → `docker compose start mailpit` → `docker compose exec postfix postqueue -c /run/postfix/conf -f`(すぐ送り直す)
