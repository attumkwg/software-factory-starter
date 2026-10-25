# 仕様: アプリ(画面と API)の前に CloudFront を置き、ALB は CloudFront からだけ受ける

> 状態: 承認済み(承認した人: @attumkwg 2026-10-25。会話で。設計書 0056 の U-9「CloudFront を前に置くのをキットの既定にする・信じるヘッダーと段数は設定で変えられる・なりすましは送り元の一覧と秘密のヘッダーで止める」)
> 設計: [docs/designs/0058-cloudfront-in-front-of-app.md](../designs/0058-cloudfront-in-front-of-app.md)・ADR: [0070](../adr/0070-cloudfront-in-front-of-alb.md)
> 決まり: `docs/security.md` の T-6(1社の暴走を止める。WAF の IP ごとの上限)・組織ごとの IP の制限(仕様 0056)。

## なぜ作るか

組織ごとの IP の制限(仕様 0056)は、いまの人の IP をヘッダーから読む。ALB をインターネットに開いたままだと、誰でも ALB に直接、好きなヘッダーを付けて送れる。持ち主の言葉では「IP はヘッダーで送られるので、攻撃者に丸見え。ヘッダーの名前なども変える必要がある」。名前を変えるだけでは止まらないので、**ALB は CloudFront からしか受けない**形にし、CloudFront を画面と API の前に置くのをキットの既定にする。WAF も CloudFront の前に移し、本当の相手の IP で数える。

## 受け入れ条件

- [ ] stg・prod で、アプリのドメイン(`app_domain`)は CloudFront に向く。画面も API も CloudFront を通る(キャッシュはしない。Cookie・クエリ・ヘッダーはそのまま渡す)
- [ ] ALB の入口(443)は、CloudFront の送り元の一覧(AWS が管理するプレフィックスリスト `com.amazonaws.global.cloudfront.origin-facing`)からだけ受ける。80 は開けない
- [ ] CloudFront は、**名前も値も秘密のヘッダー**を ALB に付けて送る。ALB は、そのヘッダーが無い・値が違うリクエストを、画面にも API にも回さない(404)。ほかの人の CloudFront から送っても通らない
- [ ] 秘密は Secrets Manager に置き(名前・いまの値・前の値)、人が入れ替えられる。入れ替えの間は前の値も通るので、止まらない(手順書)
- [ ] API と画面のサーバーは、CloudFront が付ける `CloudFront-Viewer-Address` から、いまの人の IP を読む(`CLIENT_IP_HEADER`・`TRUSTED_PROXY_HOPS`。どのヘッダーを信じるかと何段かは、設定で変えられる)
- [ ] WAF は CloudFront の前に付き、IP ごとの上限(T-6)は本当の相手の IP で数える
- [ ] 変数1つ(`app_cloudfront`)で、前の形(ALB をインターネットに開く)にも戻せる。キットの既定は CloudFront あり
- [ ] 秘密の値・ヘッダーの名前は、Terraform の plan・ログ・PR に出ない

## 権限の表に足す行

該当なし(API を足さない)。

## 要配慮個人情報

当たらない(通り道を変えるだけで、新しく集める・残す物は無い。CloudFront のアクセスログは取らない)。

## 悪用のされ方(STRIDE で1行ずつ)

| 観点 | どう悪用されうるか | どう防ぐか(テスト / ルール) |
|---|---|---|
| なりすまし | ALB に直接つなぎ、いまの人の IP のヘッダーを偽って、組織の IP の制限をすり抜ける | ALB は CloudFront の送り元だけ・秘密のヘッダーが無ければ 404。信じるヘッダーは CloudFront が付ける物(設定) |
| なりすまし | 自分の CloudFront を作って ALB に送る(送り元の一覧は全部の CloudFront) | 秘密のヘッダーは自分の CloudFront だけが知る(名前も値も) |
| 改ざん | 秘密が漏れて、外から ALB に付けて送られる | Secrets Manager で入れ替える(前の値も通る間に CloudFront を新しい値に)。値は state と Secrets Manager にだけ |
| 否認 | — | CloudTrail(秘密を読んだ・変えた)。アプリの監査ログは今のまま |
| 情報漏えい | CloudFront がアプリの応答をキャッシュして、ほかの人に返す | キャッシュしない(`Managed-CachingDisabled`)。API は `Cache-Control: no-store` |
| 妨害 | 大量のリクエスト | WAF を CloudFront の前に(IP ごとの上限を本当の IP で)。CloudFront 自体も Shield Standard |
| 権限昇格 | — | 該当なし |

## やらないこと

- 画面の静的なファイル(`/assets/*`)を CloudFront でキャッシュする(速さの改善は別。いまは全部キャッシュしない)
- ALB を VPC の中に閉じる(CloudFront の VPC オリジン)。ALB の作り直しが要るので、要るようになったら(ADR 0070 の見直す合図)
- プレビュー環境(`envs/preview`)に CloudFront を置く(1つの PR ごとの環境は今のまま)
- CloudFront のアクセスログ(IP を新しく残さない。WAF のログと API のログで足りる)

## 決めたこと

- 前に置くのは CloudFront(キットの既定)。信じるヘッダーと段数は設定で変えられる。なりすましは「送り元の一覧+名前も値も秘密のヘッダー」で止める(@attumkwg 2026-10-25。設計書 0056 の U-9)
