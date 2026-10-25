# ADR 0070: アプリの前に CloudFront を置き、ALB は送り元の一覧と秘密のヘッダーで CloudFront からだけ受ける

- 状態: 採用
- 日付: 2026-10-25
- 決めた人: @attumkwg(会話で。設計書 0056 の U-9)

## 背景

組織ごとの IP の制限(仕様 0056)は、いまの人の IP をヘッダーから読む。ALB がインターネットに開いていると、誰でも ALB に直接つなぎ、好きなヘッダーを付けられる。WAF の IP ごとの上限(T-6)も、前に中継を置くと中継の IP で数えてしまう。持ち主は「CloudFront から送る必要はあるが、IP がヘッダーで送られるのは攻撃者に丸見え。ヘッダーの名前などを変える必要がある」と言った。

## 選択肢

| 案 | 良い所 | 弱い所 |
|---|---|---|
| A. 今のまま(ALB をインターネットに。`X-Forwarded-For` の右端) | 何も変えない | ALB に直接来た人は右端を偽れないが、前に中継を足せない。DDoS・TLS は ALB だけ |
| B. CloudFront を前に。ALB は送り元の一覧(プレフィックスリスト)だけ | ALB に直接来られない | 一覧は**全部の** CloudFront。ほかの人の CloudFront からは送れる |
| C. B に加えて、CloudFront だけが知る秘密のヘッダー(名前も値も)を ALB のルールで確かめる | 自分の CloudFront だけが通る。入れ替えもできる(値を2つ受ける) | 秘密を Terraform の state と Secrets Manager に持つ。入れ替えは人の手順 |
| D. CloudFront の VPC オリジン(ALB を VPC の中だけに) | ALB が外に出ない(いちばん固い) | ALB の作り直し(内向きに)が要り、今の環境から移す手順が重い。プレビュー環境の形とも離れる |

## 決めたこと

**C**。持ち主の「ヘッダーの名前を変える」は、ヘッダーの名前と値の両方を秘密にする形で満たす(名前を変えるだけでは、見ればまねできる)。いまの人の IP は CloudFront が付ける `CloudFront-Viewer-Address` から読み、**どのヘッダーを信じるか(`CLIENT_IP_HEADER`)と何段か(`TRUSTED_PROXY_HOPS`)は設定**にする(前の形に戻す・別の中継を足すときに、コードを変えない)。WAF は CloudFront の前(us-east-1)に移し、本当の相手の IP で数える。

## 結果として起きること

- 良くなること: ALB に直接来られない・ヘッダーを偽れない。WAF の IP ごとの上限が正しい IP で効く。TLS と DDoS の守り(Shield Standard)が CloudFront の端で効く。
- 我慢すること: 秘密(Secrets Manager と Terraform の state)と、その入れ替えの手順(`docs/runbooks/cloudfront-origin.md`)。CloudFront の費用(無料枠の後は転送量とリクエスト。設計書 0058 の 8)。WAF のログとアラームが us-east-1 に移る。
- 見直す合図: 大きなお客さんの調達で「ALB が外に出ていないこと」を求められたら D(VPC オリジン)。静的なファイルの配りが重くなったら `/assets/*` のキャッシュ。
