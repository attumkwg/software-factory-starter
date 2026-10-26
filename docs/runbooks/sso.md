# 手順書: 会社のドメイン・SSO・IP の制限・強制ログアウト・SCIM(大きなお客さん向けの守り)

> 仕様は [specs/0056-sso-scim-ip-audit-export.md](../specs/0056-sso-scim-ip-audit-export.md)・設計書 0056・[ADR 0067](../adr/0067-sso-via-cognito-saml.md)。
> いまあるのは段1a(会社のドメインの確認・組織ごとの IP の制限・管理者の強制ログアウト)と段1b(SSO のつなぎ・必須・緊急用。下の 4〜7)。SCIM は段2、監査ログの書き出しは段3。
> **本番の DB・Cognito に書く操作**(下の 2・4・7)は人が打つ。AI は打たない。2人で(依頼を確かめる人と、本番の AWS に入れる開発)。

## 0. どちらもプランの機能

- 会社のドメインは `sso`、IP の制限は `ip-allowlist`(`@app/shared` の `FEATURE_FLAGS`。状態 `plan`)。プランに入れた組織だけが設定の画面に出る。プランを入れる・変えるのは [plans.md](plans.md)。
- プランから外れると、設定は残るが効かない(IP の制限は掛からない・ドメインの画面は 404)。プランに戻すと、残っていた設定がそのまま効く。戻す前に、お客さんの管理者に今の範囲で良いかを確かめてもらう。

## 1. ドメインが確かめられない(お客さんからの問い合わせ)

画面の「会社のドメイン」に出る TXT(名前 `_sfs-verify.<ドメイン>`・値 `sfs-verify=…`)を、お客さんが自分の DNS に置いてから「確かめる」を押す。

- 「DNS にまだ確かめの文字が見えません」: 置いたばかりなら DNS の反映を待つ(数分〜1日)。名前を `_sfs-verify.<ドメイン>.<ドメイン>` のように二重に書いていないか(DNS の画面によっては、名前の欄にドメインを書かない)を見てもらう。こちらからは `dig TXT _sfs-verify.<ドメイン>` で見える(公開の情報)。
- 「このドメインは、ほかの組織がもう確かめています」: 1つのドメインは1つの組織だけ。同じ会社が2つの組織を持っているなら、どちらで使うかを決めてもらい、要らない方で消してもらう。**別の会社が確かめているなら、こちらでは外さない**(乗っ取りの入口になる)。正当な持ち主かの確かめは、契約の連絡先を通して、運営の責任者が判断する。

## 2. IP の制限で締め出された(管理者も入れない)

管理者は、自分の今の IP を外す一覧は保存できない(409)。それでも、会社のネットワークの IP が変わった・管理者が外出先にいる、で全員が入れなくなることがある。

1. **依頼は契約の連絡先から受ける**(アプリの外の連絡先に電話して確かめる。メールだけで済ませない)。依頼・確かめた方法・確かめた人を、作業の記録に残す。範囲を外せば、どこからでも入れるようになるので、ここをだまされると守りが無くなる。
2. CloudShell の VPC 環境から、表の持ち主の接続(移行と同じ)で、その組織の範囲を**全部外す**(1つのトランザクションで。アプリの監査ログには残らないので、作業の記録が証跡):

```sql
BEGIN;
-- RLS は表の持ち主にもかかるので、組織を決める
SELECT set_config('app.tenant_id', '<組織の tenant_id>', true);
DELETE FROM organizations.ip_allowlist WHERE tenant_id = '<組織の tenant_id>';
-- 何行消えたかを見てから
COMMIT;
```

3. お客さんの管理者に、ログインして新しい範囲を入れ直してもらう(設定の「IP の制限」)。入れ直した記録(`ip_allowlist.update`)が監査ログに出ることを見てもらう。
4. 同じ組織から何度も依頼が来るなら、乗っ取りの試みを疑う([incident.md](incident.md))。

### いまの人の IP の数え方(ALB の前に中継を足したとき)

API は、環境変数 `CLIENT_IP_HEADER`(既定 `x-forwarded-for`)のヘッダーを右から `TRUSTED_PROXY_HOPS` 個目(既定 1 = ALB だけ)を、いまの人の IP にする。画面のサーバーも同じ `CLIENT_IP_HEADER` を読んで API に引き継ぐので、**API と画面のサーバーの両方に同じ値**を入れる。

| 前の形 | `CLIENT_IP_HEADER` | `TRUSTED_PROXY_HOPS` |
|---|---|---|
| ALB だけ(既定) | `x-forwarded-for` | 1 |
| CloudFront → ALB(CloudFront の値を使う。おすすめ) | `cloudfront-viewer-address` | 1 |
| CloudFront → ALB(X-Forwarded-For を数える) | `x-forwarded-for` | 2 |

数や名前が合わないと、全員の IP が中継の IP に見えて、制限のある組織が全員締め出される。変えた後は、設定の画面の「いまの IP」で正しい値が出ているかを確かめる。ヘッダーを信じてよいのは、ALB が CloudFront からしか受けない形(設計書 0058)が入っているときだけ。

キットの既定(Terraform の `app_cloudfront = true`)では、CloudFront を前に置き、ALB を CloudFront からだけにし、API と画面のサーバーに `cloudfront-viewer-address`・1 を入れる(手で入れなくてよい)。切り替え・確かめ・秘密のヘッダーの入れ替えは [cloudfront-origin.md](cloudfront-origin.md)。

## 3. 強制ログアウト

お客さんの管理者が、設定の「組織の人」から自分で切れる(その人のこの組織の全部の端末が、次の操作から 401)。運営は手を出さない。管理者が乗っ取られた疑いのときは [incident.md](incident.md) と [mfa-reset.md](mfa-reset.md)。

## 4. SSO をつなぐ(お客さんの情シスと)

前に要る物: Terraform の `sso_enabled = true` を apply 済み(ユーザープールの入口 `auth.<アプリのドメイン>` と、運営のコマンドの権限)・その組織のプランに `sso`・画面でドメインを**確かめ済み**。

1. お客さんの情シスに、IdP にアプリ(SAML)を作ってもらう。渡す値:
   - ACS(応答の URL): `https://auth.<アプリのドメイン>/saml2/idpresponse`
   - エンティティ ID(対象者): `urn:amazon:cognito:sp:<ユーザープールの ID>`
   - 送ってほしい属性: メールアドレス(既定の名前は `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`。違う名前なら控える)
   - 受け取る物: **メタデータの URL**(https。公開の物で、秘密ではない)
2. 移行のタスク(CloudShell から ECS の run-task。create-tenant と同じ)で、まず試し:

```bash
node dist/cli.js sso-connect <組織の tenant_id> --metadata-url <URL>
```

   確かめたドメインの数・IdP の名前(`org-…`)・メタデータの置き場所(ホスト)が出る。合っていれば `--execute` を付けて流す(属性の名前が違うなら `--email-attribute <名前>`)。
3. 組織の管理者に、ログインの画面の「会社のアカウントでログイン」で入ってもらう。入れたら、管理者が設定の「SSO」で**緊急用の管理者**(1〜2人。二段階認証を設定してもらう)を選んでから「必須」を入れる。
4. 入れないとき: 画面は理由を言わない(`?sso=failed`)。アプリのログの `SSO のログインを断りました` の `reason` を見る。

| reason | よくある原因 |
|---|---|
| `idp_error:…` | IdP 側で断られた・利用者が取り消した・ACS やエンティティ ID の打ち間違い |
| `code_rejected` | コードの交換に失敗(時計のずれ・戻りの URL が Cognito のコールバックと違う) |
| `no_member` | その組織にそのメールの人がいない(SSO は人を作らない。招待するか、段2 の SCIM で)・メールの属性が届いていない(`--email-attribute`)・確かめたドメインの外のメール |
| `feature_off` | 組織のプランに `sso` が無い |
| `state_mismatch` | 10分以上かかった・別のタブで始め直した。もう一度ログインの画面から |

### 手元で試す

`docker compose -f docker-compose.yml -f docker-compose.cognito.yml up --build -d` で、種データの **Initech**(`initech.test` を確かめ済み・IdP `org-seed-initech` をつないだ組織)が使える。ログインの画面の「会社のアカウントでログイン」で `member@initech.test` などを入れると、偽物の Cognito の「テスト用の IdP」の画面(メールを入れるだけ)へ移り、戻るとその組織に入る。E2E は `apps/web/e2e/cognito-sso.spec.ts`。

## 5. IdP の証明書が変わる・IdP が止まった

- 証明書の更新: メタデータの URL を渡してあれば、Cognito がメタデータを読み直す(だいたい6時間ごと)。急ぐなら、外してつなぎ直す(下の 7 → 4。つなぎ直すまで SSO で入れないので、必須の組織は先に緊急用で入れることを確かめる)。
- IdP が止まった: 必須の組織では、**緊急用の管理者だけ**がパスワード+二段階認証で入れる。緊急用が入って、一時的に「必須」を外すと、確かめたドメインの人もパスワードで入れる(Cognito にパスワードのアカウントがある人だけ)。戻ったら必須を入れ直す。
- 緊急用の管理者も入れない(二段階認証の端末を無くした): [mfa-reset.md](mfa-reset.md) の手順で本人を確かめてから。

## 6. プランから sso が外れたとき

- SSO で入れなくなる(戻りで断る)。必須も効かなくなるので、確かめたドメインの人はパスワードで入れる(Cognito にパスワードのアカウントがある人だけ)。
- 解約・プランの変更が決まったら、先にお客さんに伝え、IdP を外す(下の 7)。

## 7. SSO を外す

```bash
node dist/cli.js sso-disconnect <組織の tenant_id>            # 試し(IdP の名前が出る)
node dist/cli.js sso-disconnect <組織の tenant_id> --execute
```

先に DB の行を消して SSO と必須を止め、それから Cognito のアプリクライアントの一覧から外して IdP を消す。Cognito の掃除の途中で落ちたら、もう一度流すと「つないでありません」になるので、AWS のコンソールで IdP(`org-…`)をアプリクライアントの一覧から外して消す。解約の削除([offboarding.md](offboarding.md))の前にも流す。

## 8. SCIM をつなぐ(お客さんの情シスと。段2)

プランの機能 `scim` と、確かめたドメインが要る(SCIM で作れるのは、確かめたドメインのメールの人だけ)。運営は手を出さない(お客さんの管理者が自分でつなぐ)。

1. お客さんの管理者が、設定の「SCIM(情シスの道具との連携)」で鍵を作る(画面に1回だけ出る。生きている鍵は2つまで)
2. 情シスの道具に、入口 `https://<アプリ>/api/scim/v2` と鍵(Bearer)を入れる。
   - Entra ID: エンタープライズ アプリケーション → プロビジョニング → 自動。「テナントの URL」に入口、「シークレット トークン」に鍵。属性の対応は `userName` ← UPN かメール・`active`・`displayName`・`externalId` だけで足りる(ほかは聞き流す)
   - Okta: アプリの Provisioning → SCIM。認証は HTTP Header(Bearer)。「Create Users」「Update User Attributes」「Deactivate Users」を入れる。一意の項目は `userName`
3. 道具の「接続のテスト」は `GET /Users?filter=userName eq "…"` を呼ぶ。設定の画面の「最後に使われた」が変われば届いている
4. ロールは道具からは変わらない(作った人は member)。管理者は画面で上げる

困ったとき:

| 道具の失敗 | わけ | すること |
|---|---|---|
| 401 | 鍵が違う・取り消した | 管理者が鍵を作り直して、道具に入れ直す |
| 403 | プランに `scim` が無い | 契約を確かめる(`plan` のコマンド) |
| 400 invalidValue(作るとき) | メールのドメインが、その組織の確かめたドメインではない | 管理者がドメインを登録して DNS で確かめる(上の 1) |
| 409 uniqueness | 同じメールの人がもういる(招待で入った人など) | 道具の側で、その人を「今いる人」と結びつける(Entra ID は照合の属性を `userName` に) |
| 400 mutability | 道具がメールを変えようとした | メールは本人が画面で変える。道具の属性の対応からメールの更新を外す |

- 止めた人(`active: false`・DELETE)は、次のリクエストから 401。行・名前・メール・監査ログは残る(消すのは 1人分の削除の手順 [person-data.md](person-data.md))。道具から `active: true` で戻せる
- 鍵が漏れた疑い: 管理者がすぐ取り消す(取り消した鍵は戻らない)。監査ログの「SCIM が」の行で、その鍵がしたことを確かめる(行為者の ID が鍵の ID)
