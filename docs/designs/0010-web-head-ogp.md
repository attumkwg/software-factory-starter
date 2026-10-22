# 設計: 画面の表側の残り(説明と OGP・アイコン・狭い画面の表と入力・無い URL)

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0010-web-head-ogp.md](../specs/0010-web-head-ogp.md)
> 状態: 下書き(未確定事項なし。承認は PR で)
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

`apps/web/src/head.ts` の `pageHead` が、画面ごとの title・説明・OGP を route の `head` に返す。root が既定を出し、画面が上書きする。公開の画面(ログイン・登録・再設定・規約の本文)は説明と `og:url` も出す。
検索に載せるかは今までどおり画面のサーバー(`server/app.ts`)だけが決める(全部 noindex)。あわせて、ホーム画面のアイコン(PNG)と、スマホの幅で一度も開いていなかった画面の E2E、深いパスの 404 を足す。

## 作業の前に読んだ物(ガイド)

- `docs/design-system.md`・`apps/web/CLAUDE.md`: 画面ごとの CSS は書かない・部品の側で直す。幅 320px で横にはみ出さない。静的なファイルは `public/`
- `docs/specs/0008-web-noindex-mobile.md`・`docs/designs/0008-web-noindex-mobile.md`: #6 で、表の横スクロールの枠(`.ui-table-scroll`)・入力欄の `min-width: min(16rem, 100%)`・`favicon.svg`・無い URL の 404(E2E)・全部の応答に noindex が入った。**点検の 🟡 の「表のはみ出し」「favicon」「404」の芯は #6 で済んでいる**。残りは確かめる範囲(スマホで開いていない画面・深いパス)と、iOS のアイコン
- `apps/web/src/routes/*.tsx`: 全部の route が `head: () => ({ meta: [{ title: "<名前> | Tasks" }] })` を手で書いていた。説明・OGP はどこにも無い
- TanStack Router の `HeadContent`(`headContentUtils.js`): 深い route から順に見て、同じ `name` / `property` の meta は最初(=深い方)だけ残す。title も深い方。**root に既定を置けば、画面ごとに上書きできる**
- `apps/web/src/report-error.ts`: サーバーの環境変数をブラウザに渡すのに、`createIsomorphicFn` と `<html data-*>` を使っている(DSN)。同じ形にする
- `apps/api/src/config.ts`・`infra/terraform/envs/*/main.tf`: 画面の URL は API の `APP_URL`(メールのリンク)。stg・prod は API のサービスにだけ渡していて、画面のサービス(`module "web"`)には渡していない
- `docker-compose.yml`: 画面(web)に `APP_URL` が無い
- `apps/web/e2e/legal.spec.ts`・`support.spec.ts`: 同意・許可という戻せない書き込みを含む(1回の起動で1度だけ通る)。スマホの組にそのまま足すと、パソコンの組と同じ人で2回書き込んで落ちる

## 1. 設計方針

- **title・説明・OGP は1つの関数(`pageHead`)で作る**。全部の route がこれを使う(手書きの `{ title: "… | Tasks" }` をやめる)。プロダクトの名前(`SITE_NAME`)と既定の説明(`SITE_DESCRIPTION`)は `head.ts` の1か所。キットを使う人は2行を直せばよい。
- **検索に載せるかは決めない**。`pageHead` は `<meta name="robots">` を出さない。決めるのは #6 の画面のサーバー(`X-Robots-Tag`・`INDEXABLE_PATHS`)だけ。2か所で決めると、片方を直したときに食い違う。
- **OGP は検索とは別の物**として扱う。OGP はチャットにリンクを貼ったときのカード(Slack・Teams など)のためで、検索に載せなくても役に立つ。noindex と OGP は両立する。
- `og:url`・`og:image` の元は **環境変数 `APP_URL` だけ**(API と同じ名前)。要求の Host ヘッダーは使わない(外から変えられる値で絶対 URL を作らない)。無ければ出さない。
- サーバーの値をブラウザに渡すのは `report-error.ts` と同じ形(`createIsomorphicFn` と `<html data-app-url>`)。SSR とブラウザで同じ meta になり、hydration がずれない。
- アイコンの PNG は依存を足さずに作る(Node の `zlib` で書いた180×180。形は `favicon.svg` と同じ)。`public/` に置けば #6 の仕組みでそのまま返る。
- 狭い画面の確かめは、**見るだけの E2E を1本**(`narrow-screens.spec.ts`)足し、スマホの組でだけ流す。書き込みを含む既存の E2E はスマホの組に足さない(2回書き込んで落ちる)。
- 部品(`packages/ui`)はバッジの折り返しだけ直す(11)。#6 の表の枠と入力欄の幅で、足した画面もはみ出さない(E2E で確かめた)。

## 2. データモデル

該当なし(DB を触らない)。

## 3. API

該当なし(API を足さない・変えない)。画面の `<head>` が変わる:

| 画面 | title | 説明 | og:type | og:url |
|---|---|---|---|---|
| 既定(root・説明の無い画面) | `Tasks` | `SITE_DESCRIPTION` | website | 出さない |
| `/login` | `ログイン \| Tasks` | ログインして…開きます | website | `<APP_URL>/login` |
| `/sign-up` | `登録 \| Tasks` | アカウントを…作ります | website | `<APP_URL>/sign-up` |
| `/forgot-password` | `パスワードの再設定 \| Tasks` | …設定し直します | website | `<APP_URL>/forgot-password` |
| `/legal/<文書>` | `<文書の名前> \| Tasks` | いま効いている版の本文と変更の履歴 | article | `<APP_URL>/legal/<文書>` |
| `/legal/<文書>/<版>` | `<文書の名前>(版 N) \| Tasks` | 版 N の本文 | article | `<APP_URL>/legal/<文書>/<版>` |
| ログインの後ろの画面 | `<画面の名前> \| Tasks` | 既定 | website | 出さない |

どの画面も `og:site_name`(`Tasks`)・`og:title`(画面の名前だけ)・`og:description`(説明と同じ)・`og:locale`(`ja_JP`)を出す。`og:image` は `pageHead({ image: "/og.png" })` で出せるが、いまはどの画面も渡さない。

静的なファイル: `/apple-touch-icon.png`(180×180・919 バイト)を足す。キャッシュは #6 の `public/` と同じ1日。

## 4. 状態遷移

該当なし(状態を持たない)。

## 5. システム間連携

- チャットのカード(Slack・Teams・LINE など)は、HTML の `og:*` を読む。`og:url` と `og:image` は絶対 URL が要る。
- 本番以外(プレビュー・stg)は `robots.txt` で全部お断り(#6)なので、カードを作る仕組みによっては読みに来ない。業務の画面なので、それで困らない。
- 検索の仕組みは、`og:*` があっても `X-Robots-Tag: noindex` を守る。

## 6. 業務ルール

- `og:url` は `APP_URL` の origin+画面のパス。パスは `/` で始まるものだけ、`?` と `#` 以降は落とす(戻り先や絞り込みを外に出さない)。
- `APP_URL` は `http:` か `https:` の正しい URL だけ使う。パスや末尾の `/` は落とす(origin だけ)。壊れた値・無いときは `og:url`・`og:image` を出さない。
- ログインの後ろの画面には `path` を渡さない(`og:url` を出さない)。カードの取得はログインの画面へ回るので、そもそも中身は出ない。
- `<meta name="robots">` は出さない。
- 無い URL: ログインの後ろの画面の形(`/projects/…` など、`_app` の下に途中まで当たる)は、ログイン前は `_app` の関所がログインの画面へ回す(307。どのパスがあるかを明かさない)。ログインした人には 404。どこにも当たらないパス(`/no/such/page`)は、ログインに関わらず 404。手元で確かめた(直す前から、この動き)。

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 1つの関数で title・説明・OGP | 1. 設計方針・3 | `src/head.test.ts`「公開の画面: …」「引数なし(root の既定)…」 |
| 公開の画面が説明と OGP を出す | 3 の表 | E2E `not-found.spec.ts`「公開の画面は title・説明・OGP を出し…」・`head.test.ts`「legalDocumentHead …」 |
| 説明の無い画面は既定の説明 | 3 の表 | `head.test.ts`「引数なし…」・「無い文書は…」 |
| og:url・og:image は絶対 URL・無ければ出さない | 6 | `head.test.ts`「APP_URL が無いときは…」「originOf …」 |
| og:url に ? 以降を載せない | 6 | `head.test.ts`「og:url に ? 以降を載せない…」 |
| noindex と食い違わない・robots の meta を出さない | 1. 設計方針・6 | `head.test.ts`「検索に載せるかは決めない…」・E2E `not-found.spec.ts`(`X-Robots-Tag` と `meta[name=robots]` が0個) |
| apple-touch-icon | 3 | E2E `not-found.spec.ts`「robots.txt は…・favicon は…」 |
| スマホの幅で、主な流れ以外の画面もはみ出さない | 1. 設計方針 | E2E `narrow-screens.spec.ts`(スマホの組) |
| 深いパスも 404 | (既存の `NotFoundPage`) | E2E `not-found.spec.ts`「無い URL を開くと 404…」(パソコンとスマホ) |
| 404 の画面に最初の画面へのリンク | (`NotFoundPage`) | E2E `not-found.spec.ts`「無い URL を開くと 404…」 |
| バッジは狭い列で折り返さない | (`.ui-badge` の `white-space: nowrap`) | スクショで確認(スマホのサポートへの許可) |
| ログインの後ろの形の無いパス: ログイン前はログインへ・後は 404 | 6. 業務ルール | E2E `not-found.spec.ts`「ログインの後ろの形をした無い URL…」(パソコンとスマホ) |

## 8. 非機能

- 性能: `<head>` に meta が7〜8個増えるだけ。画面の JS は `head.ts` の分(1KB 未満)だけ増える。
- セキュリティ: 仕様の STRIDE のとおり。`og:url` の元は環境変数だけ。
- 運用: **stg・prod の画面のサービスには `APP_URL` がまだ無い**ので、`og:url` は出ない(他の OGP は出る)。出したくなったら、`infra/terraform/envs/{stg,prod}/main.tf` の `module "web"` の `environment` に `APP_URL = "https://${var.app_domain}"` を1行足す(危険度「高」。人が別の PR で)。プレビュー(`modules/preview-env`)も同じ。
- 費用: 無し。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離 | 該当なし(テナントの値を読まない。ログインの後ろの画面の title はもともと出ていた) |
| 権限の表 | 該当なし(API を足さない) |
| 監査ログ | 該当なし(書き込みを足さない) |
| 解約で消す一覧 | 該当なし(表を足さない) |
| サポートの代理ログイン | 該当なし |
| ログの個人情報 | 該当なし(ログを足さない) |
| 画面の部品 | `.ui-badge` を折り返さない。404 の画面に `Link`。全部の route の `head` を `pageHead` にした |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 採用 | 検索の決まりは画面のサーバー1か所のまま。title・説明・OGP は関数1つ |
| データモデル | 低優先 | DB を触らない |
| API | 低優先 | API を触らない |
| 状態遷移 | 低優先 | 状態を持たない |
| システム間連携 | 軽く確認 | チャットのカードと `og:url` の絶対 URL |
| 業務ルール | 機械で検証 | `og:url` の作り方は単体テストが1対1 |
| 要求との対応 | 機械で検証 | 単体と E2E が受け入れ条件と1対1 |
| 非機能 | 軽く確認 | stg・prod の `APP_URL` は人の別の PR |
| 画面の部品 | 機械で検証 | スマホの組の axe と横はみ出しの検査 |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- **`<meta name="robots">` を出さない** — 検索の決まりは #6 の画面のサーバー1か所。meta と header の2か所にすると、片方だけ直して食い違う。
- **全部の route を `pageHead` にした**(公開の画面だけでなく) — 書き方が2つあると、新しい画面が古い書き方を写す。title の「 | Tasks」も1か所になる。
- **`og:url` の元は環境変数 `APP_URL`(要求の Host を使わない)** — 外から変えられる値で絶対 URL を作らない。名前は API と同じにして、設定の取り違えを減らす。
- **`APP_URL` が無ければ `og:url`・`og:image` を出さない** — 相対の URL はカードの仕組みが読めない。壊れた値を出すより出さない方がよい。
- **stg・prod の Terraform は触らない** — 危険度「高」(`infra/**`)。`og:url` が無くてもカードは出る。足し方は 8 に書いた。
- **`og:title` は画面の名前だけ**(「 | Tasks」を付けない) — カードは `og:site_name` を別に出す。
- **既定の `og:image` を置かない** — カードの画像はプロダクトの絵。キットの仮の絵が本番に出ると困る。関数は受け取れる。
- **アイコンの PNG は依存を足さずに作った** — 画像の道具を足すほどの物ではない。iOS が角を丸めるので、地は四角のまま(透明にしない)。
- **狭い画面は、見るだけの E2E を1本足してスマホの組でだけ流す** — 既存の `legal.spec.ts`・`support.spec.ts` は戻せない書き込み(同意・許可)を含み、パソコンとスマホで2回流すと落ちる。見るだけなら並びで流れても食い違わない。
- **部品(`packages/ui`)はバッジだけ直す** — #6 の表の枠と入力欄の `min()` で、足した画面も 320px ではみ出さなかった。ただしスマホのサポートへの許可の表で、状態のバッジ(「有効」)が1文字ずつ縦に折り返したので、`.ui-badge` に `white-space: nowrap`(札は短い言葉。表は枠の中で横に動くので、広がっても画面ははみ出さない)。
- **404 の画面に「最初の画面へ」のリンク** — 戻る先が無いと行き止まり。`/` はログイン前ならログインの画面へ回るので、どちらの人にも使える。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|

なし(4つの種類に当たる判断が無い。stg・prod に `APP_URL` を渡すのは、決めることではなく危険度「高」の作業なので 8 に書いた)。

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
