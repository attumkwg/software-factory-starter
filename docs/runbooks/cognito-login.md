# 手順書: Cognito でのログイン(人を入れる・ログインできないとき)

> 決まり: **誰でも登録できる。アプリに入れるのは `organizations.users` にいる人だけ**(ADR 0007・0009)。
> 初めてのログインで、Cognito が「確認済み」と言うメールが users の行と一致したら、その行に Cognito の sub が結びつく。

## 新しい人を入れる

新しい組織の最初の管理者は、運営のコマンド `create-tenant` で作る([tenant-provisioning.md](tenant-provisioning.md))。ここは、すでにある組織に人を足すとき。

招待の画面はまだ無い(次の一歩)。それまでは、移行の接続ユーザー(表の持ち主)で行を足す。

```sql
-- メールは小文字で。external_id は空のまま(初めてのログインで埋まる)
INSERT INTO organizations.users (id, tenant_id, email, name, role)
VALUES (gen_random_uuid(), '<組織の tenant_id>', 'new.person@example.com', '新しい人', 'member');
```

その人に「アプリの URL を開いて『初めての方は登録』→ メールの確認コードを入れる → ログイン」と伝える。

## ログインできないと言われたら

画面は理由を言わない(「メールアドレスかパスワードが正しくありません」だけ。どこが違ったかを教えると、登録の有無を確かめる手がかりになる)。理由はログで見る。画面の問い合わせ番号が `requestId`。

```
fields @timestamp, requestId, message, what, reason, hasVerifiedEmail
| filter service = "api" and (message = "Cognito が断りました" or message like /ログインに失敗/)
| sort @timestamp desc
```

| ログ | 意味 | どうするか |
|---|---|---|
| `Cognito が断りました`・`reason: NotAuthorizedException` | パスワードが違う・その人がいない・続けて間違えて止められた(`what: sign_in`) | パスワードの再設定を案内する。止められたときは少し待つ |
| `ログインに失敗(users に結びつく行が無い)`・`hasVerifiedEmail: false` | Cognito ではパスワードが通ったが、メールが確認済みでない(管理の操作で確認しただけ など) | パスワードの再設定をしてもらう(確認コードでメールが確認済みになる) |
| `ログインに失敗(users に結びつく行が無い)`・`hasVerifiedEmail: true` | users にそのメールの行が無い・**別の Cognito のアカウントと結びついている** | 下の「結びつきを直す」 |
| `reason: CodeMismatchException` / `ExpiredCodeException` | 確認コード・二段階認証のコードが違う・切れた | コードを送り直す。二段階認証なら端末の時計がずれていないか |
| `reason: InvalidPasswordException` | パスワードが決まりを満たさない | 画面に決まりが出ている(`cognito-settings.json`) |
| status 429 | Cognito の流量の上限・試しすぎ | 少し待つ。続くなら Cognito の上限(サービスクォータ)を見る |
| status 503(error のログ) | Cognito か DB に届かない | NAT・セキュリティグループ・Cognito の障害を確かめる |

### 結びつきを直す(Cognito のアカウントを作り直した人)

Cognito で一度消して登録し直すと sub が変わる。users の行は前の sub と結びついたままなので、ログインできない(付け替えはわざとできないようにしてある)。本人であることを確かめてから:

```sql
-- 2人で確かめてから流す。誰の・なぜを、#incident か作業の記録に残す
UPDATE organizations.users SET external_id = NULL WHERE email = 'person@example.com';
```

次のログインで、新しい sub と結びつく。

### メールアドレスが Cognito と users で食い違った(極めてまれ)

メールの変更の確認で、Cognito のメールは替わったが、同じ瞬間に同じアドレスの users の行が足されて、users の更新がぶつかったとき(ログに error `Cognito のメールは替わったが、users の更新がぶつかりました`。Sentry にも届く)。本人は新しいアドレスでログインできる(結びつきは sub なので)。表示のメールだけが古い。本人と、ぶつかった行の持ち主を確かめてから、どちらかを直す:

```sql
-- 2人で確かめてから流す(文脈を付けて)。誰の・なぜを、#incident か作業の記録に残す
UPDATE organizations.users SET email = '<新しいアドレス>' WHERE id = '<本人の users.id>';
```

ぶつかった行が別の人のものなら、本人の Cognito のメールを戻す(`aws cognito-idp admin-update-user-attributes --user-attributes Name=email,Value=<古いアドレス> Name=email_verified,Value=true`)。

## 二段階認証の写しがずれた

`users.mfa_enabled` は Cognito の写し(正は Cognito)。ログインのたび・パスワードを入れ直すたびに直るので、ふつうは何もしない。認証アプリを無くした人を戻すのは [mfa-reset.md](mfa-reset.md)。

## stg で本物を確かめる(Terraform を変えたとき・初めて作ったとき)

手元の偽物の Cognito では確かめられない所。

まず契約テストを流す(Actions → **Cognito contract**)。偽物とのずれは、これが見つける。そのうえで、人の目で:

- [ ] 登録 → 確認コードのメールが SES から届く(迷惑メールに入らない・文面が `cognito-settings.json` どおり)→ ログインできる
- [ ] users にいない人は「メールアドレスかパスワードが正しくありません」
- [ ] 開いていた画面(`/projects/...`)に戻る
- [ ] パスワードを忘れた → 再設定のメールが届く → 新しいパスワードでログインできる
- [ ] ブラウザの開発者ツールで、`/api/auth/login` の応答とページの中にトークン(`eyJ…`)が無い
