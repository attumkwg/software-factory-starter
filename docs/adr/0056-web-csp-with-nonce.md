# ADR 0056: 画面の CSP は、画面のサーバーが1リクエストごとに作る nonce と自分の origin だけを許す

- 状態: 提案
- 日付: 2026-10-25
- 決めた人: @attumkwg(提案は AI。承認待ち)

## 背景

- 画面に CSP が無く、外部の診断ではほぼ必ず指摘される(想定の場面の 6-7・穴 G-17)。
- 画面は TanStack Start の SSR で、HTML に水和(ブラウザで命を吹き込む)のためのスクリプトを埋め込む。埋め込みを許すには `'unsafe-inline'` か nonce・hash が要る。
- 画面のサーバーは Hono(`apps/web/server/app.ts`)で、守りのヘッダーはすでに `secureHeaders` が付けている。

## 選択肢

| 案 | 良い所 | 弱い所 |
|---|---|---|
| A. 1リクエストごとの nonce(Hono の `NONCE`)を SSR に渡し、TanStack の `ssr.nonce` で埋め込みに付ける | 差し込まれた埋め込みは動かない。依存を足さない。HTML は `no-store` なので nonce の使い回しも起きない | SSR に値を渡す道が1つ増える。Zod の試し(`new Function`)を止める要る |
| B. `script-src 'unsafe-inline'` | 何も変えずに付けられる | XSS を止められない。診断で「無いのと同じ」と言われる |
| C. 埋め込みの hash | 応答ごとに変わらない | 埋め込みの中身(読み込んだデータ)が毎回変わるので hash にできない |
| D. ALB・CloudFront でヘッダーを付ける | アプリを触らない | nonce を HTML と合わせられない |

## 決めたこと

A。`script-src 'self' 'nonce-…'`・`style-src 'self' 'nonce-…'`・`style-src-attr 'unsafe-inline'`(部品が描く style 属性)・`connect-src` は自分と Sentry の origin・`object-src`・`base-uri`・`frame-ancestors` は `'none'`。違反は E2E(`csp.spec.ts`)で見つけ、出たら落とす。詳しくは設計書 0045。

## 結果として起きること

- 良くなること: 差し込まれたスクリプトが動かない。よそのサイトに枠で埋め込まれない。外部の診断の指摘が減る。
- 我慢すること: 外の物(スクリプト・画像・フォント・送り先)を足すたびに CSP も直す。埋め込みのスクリプト・`eval` の類が書けない。
- 見直す合図: 外の物を読む画面(地図・決済の部品など)を足すとき。本番で違反を数えたくなったとき(report-to の受け口を API に)。
