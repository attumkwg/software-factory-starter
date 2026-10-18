# 手順書: Cognito でのログイン(人を入れる・ログインできないとき)

> 決まり: **誰でも Cognito に登録できる。アプリに入れるのは `organizations.users` にいる人だけ**(ADR 0007)。
> 初めてのログインで、Cognito が「確認済み」と言うメールが users の行と一致したら、その行に Cognito の sub が結びつく。

## 新しい人を入れる

招待の画面はまだ無い(次の一歩)。それまでは、移行の接続ユーザー(表の持ち主)で行を足す。

```sql
-- メールは小文字で。external_id は空のまま(初めてのログインで埋まる)
INSERT INTO organizations.users (id, tenant_id, email, name, role)
VALUES (gen_random_uuid(), '<組織の tenant_id>', 'new.person@example.com', '新しい人', 'member');
```

その人に「アプリの URL を開いて『ログイン』→ 初めてなら Cognito の画面で登録 → メールの確認コードを入れる」と伝える。

## ログインできないと言われたら

画面は理由を言わない(「ログインできませんでした」だけ。どこが違ったかを教えると、登録の有無を確かめる手がかりになる)。理由はログで見る。

```
fields @timestamp, requestId, message, reason, hasVerifiedEmail
| filter service = "api" and (message like /Cognito からの戻り/ or message = "ログインに失敗")
| sort @timestamp desc
```

| ログ | 意味 | どうするか |
|---|---|---|
| `ログインに失敗`・`hasVerifiedEmail: false` | Cognito でメールを確認していない | 確認コードのメールを探してもらう(迷惑メールも) |
| `ログインに失敗`・`hasVerifiedEmail: true` | users にそのメールの行が無い・**別の Cognito のアカウントと結びついている** | 下の「結びつきを直す」 |
| `reason: state_mismatch` / `no_pending_login` | ログインの途中で10分以上たった・別のタブで始め直した・戻りの URL だけを踏んだ | もう一度「ログイン」から |
| `reason: cognito_error` | Cognito の画面で「やめる」を押した、または Cognito 側の設定の誤り | 続くなら、Cognito のアプリクライアントの戻り先(`callback_urls`)を確かめる |
| `reason: token_endpoint_400` | code が古い・使い済み・戻り先の URL が登録と違う | 続くなら `APP_URL` と `callback_urls` が同じかを確かめる |
| `Cognito か DB に届かず`(error) | Cognito か DB に届かない | 画面は「止まっています」。NAT・セキュリティグループ・Cognito の障害を確かめる |

### 結びつきを直す(Cognito のアカウントを作り直した人)

Cognito で一度消して登録し直すと sub が変わる。users の行は前の sub と結びついたままなので、ログインできない(付け替えはわざとできないようにしてある)。本人であることを確かめてから:

```sql
-- 2人で確かめてから流す。誰の・なぜを、#incident か作業の記録に残す
UPDATE organizations.users SET external_id = NULL WHERE email = 'person@example.com';
```

次のログインで、新しい sub と結びつく。

## stg で本物を確かめる(Terraform を変えたとき・初めて作ったとき)

手元の偽物の Cognito では確かめられない所。

- [ ] 「ログイン」で Cognito の画面が出る。登録 → 確認コードのメール → ログインして、アプリに戻る
- [ ] users にいない人は「ログインできませんでした」
- [ ] 開いていた画面(`/projects/...`)に戻る
- [ ] ログアウトの後に「ログイン」を押すと、Cognito の画面でもう一度聞かれる(Cognito 側も終わっている)
- [ ] パスワードを忘れた → 再設定のメールが届く
- [ ] ブラウザの開発者ツールで、`/api/auth/callback` の応答とページの中にトークン(`eyJ…`)が無い
