# 手順書: アプリの前の CloudFront(切り替え・確かめ・秘密のヘッダーの入れ替え)

> 仕様は [specs/0058-cloudfront-in-front-of-app.md](../specs/0058-cloudfront-in-front-of-app.md)・[ADR 0070](../adr/0070-cloudfront-in-front-of-alb.md)。
> **本番の AWS に書く操作**(Terraform の apply・Secrets Manager の値)は人が流す。AI は打たない。2人で(1人が打ち、1人が画面と手順を見る)。
> 秘密(ヘッダーの名前と値)は**画面に出さない・どこにも貼らない**(作業の記録・Slack・PR・Issue に書かない)。

## 0. 形

```
ブラウザ → https://<app_domain>(CloudFront。WAF は us-east-1)
        → https://origin.<app_domain>(ALB。CloudFront の送り元の一覧だけ・443)+ 秘密のヘッダー
        → ALB のルール: 秘密のヘッダーが「いまの値」か「前の値」なら API(/api/*)・画面(/*)へ。違えば 404
```

- 秘密: Secrets Manager の `<名前>-<env>/cloudfront-origin`(`{"name": "x-origin-…", "current": "…", "previous": ""}`)
- いまの人の IP: API と画面のサーバーの `CLIENT_IP_HEADER=cloudfront-viewer-address`・`TRUSTED_PROXY_HOPS=1`(Terraform が入れる。[sso.md](sso.md) の 2)
- 切り替えの変数: `app_cloudfront`(既定 `true`)。`false` で前の形(ALB をインターネットに・WAF は ALB)

## 1. 初めて切り替える(既に動いている環境。stg → 1週間 → prod)

1. 人の少ない時間を選ぶ。DNS が切り替わる数分は、古い向き先(ALB に直接)の人が 404 か、つながらないことがある。
2. いつもどおり Terraform の plan を見る(`terraform-plan.yml`)。増える・変わる物:
   - `module.app_front[0]`(CloudFront・us-east-1 の証明書・秘密・オリジンへのリクエストの決まり)
   - `module.waf_front[0]`(CloudFront の WAF・us-east-1)と、`module.waf[0]`(ALB の WAF)の削除
   - ALB の証明書の作り直し(`origin.<app_domain>` を別名に足す)・ALB の入口の規則(0.0.0.0/0 → CloudFront の送り元)・ALB のルールの条件(秘密のヘッダー)
   - `aws_route53_record.app` の向き先(ALB → CloudFront)・`app_ipv6`・`origin`
   - API と画面のタスクの環境変数(`CLIENT_IP_HEADER`・`TRUSTED_PROXY_HOPS`。新しいタスク定義)
   - 秘密の値・ヘッダーの名前は `(sensitive value)` で出る(出ていたら止める)
3. apply する(いつもの流し方)。
4. 確かめる(下の 2)。おかしければ 5 で戻す。

## 2. 確かめる(切り替えの後・入れ替えの後)

```bash
D=<app_domain>
# 画面と API が開く(CloudFront を通る)
curl -sS -o /dev/null -w '%{http_code}\n' "https://$D/"            # 200
curl -sS -o /dev/null -w '%{http_code}\n' "https://$D/api/auth/options"  # 200(ログイン無しで読める API)
dig +short "$D"                                                     # CloudFront の IP(ALB ではない)
# ALB に直接は届かない(送り元が CloudFront ではないので、つながらずに時間切れ)
curl -sS -m 10 -o /dev/null -w '%{http_code}\n' "https://origin.$D/" || echo "届かない(正しい)"
```

- 画面にログインし、設定の「IP の制限」(プランに `ip-allowlist` がある組織)の「いまの IP」が、自分の本当の IP であること。
- **偽ったヘッダーが効かないこと**: 同じ画面を開くリクエストに `CloudFront-Viewer-Address: 203.0.113.1:1` を付けても(ブラウザの開発ツールか `curl -H` で Cookie を付けて `GET /api/organization/ip-allowlist`)、`yourIp` が自分の本当の IP のまま。203.0.113.1 になったら、すぐに 5 で戻し、開発に知らせる。
- WAF(us-east-1)の「サンプルのリクエスト」の送り元が、本当の相手の IP であること(CloudFront の IP ではない)。

## 3. 秘密のヘッダーを入れ替える(年に1回と、漏れた疑いのとき)

入れ替えの間は ALB が「いまの値」と「前の値」の両方を通すので、止まらない。

```bash
SECRET=<名前>-<env>/cloudfront-origin
# 1. いまの値を「前の値」に、新しい値を「いまの値」に(画面に出さない)
OLD=$(aws secretsmanager get-secret-value --secret-id "$SECRET" --query SecretString --output text)
NEW_VALUE=$(openssl rand -hex 24)
aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string \
  "$(jq -c --arg v "$NEW_VALUE" '.previous = .current | .current = $v' <<<"$OLD")"
unset OLD NEW_VALUE
```

2. Terraform を apply(CloudFront は新しい値を送り、ALB は新しい値と前の値を通す)。CloudFront の反映(数分〜15分)を待つ。
3. 2 の確かめ。
4. 1日ほど後に「前の値」を空にして、もう一度 apply(ALB は新しい値だけを通す):

```bash
OLD=$(aws secretsmanager get-secret-value --secret-id "$SECRET" --query SecretString --output text)
aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string "$(jq -c '.previous = ""' <<<"$OLD")"
unset OLD
```

- **ヘッダーの名前は、ふだんは変えない**(ALB のルールは名前を1つしか見られないので、変えると反映までの数分は 404 になる)。名前まで漏れた疑いがあれば、`.name` も新しく(`x-origin-` と英小文字・数字 12 文字)して、人の少ない時間に 2 と 4 を一度に流す。
- 作業の記録には「入れ替えた・いつ・誰が」だけを書く(値は書かない)。

## 4. 漏れた疑いのとき

秘密の値が漏れると、送り元の一覧の中(ほかの人の CloudFront)からは ALB に届きうる。すぐに 3 を流し(前の値は 4 まで待たずに空に)、[secret-leak.md](secret-leak.md) に記録する。[attack.md](attack.md) の見方で、ALB のアクセス(ターゲットの 4xx・5xx)と WAF を見る。

## 5. 戻す(前の形に)

`app_cloudfront = false` にして apply。`app_domain` の向き先が ALB に戻り、ALB はインターネットから受け、WAF は ALB に戻る。API と画面のサーバーは既定の `x-forwarded-for` を読む。秘密(Secrets Manager)は消える(次に `true` にしたら新しく作られる)。
