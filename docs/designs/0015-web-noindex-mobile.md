# 設計: 画面の表側(検索に載せない・スマホの幅)

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0015-web-noindex-mobile.md](../specs/0015-web-noindex-mobile.md)
> 状態: 承認済み(未確定事項は全部答え済み。@attumkwg 2026-10-22「PR #6 の U-1 は『本番も全部検索に載せない』で承認します」)
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

画面のサーバー(`apps/web/server/app.ts`)が、全部の応答に `X-Robots-Tag: noindex, nofollow` を付け、`/robots.txt` と `public/` の物(favicon)を返す。本番で外せるのは「公開してよいページ」の一覧に書いたパスだけ(いまは空)。
E2E にスマホの組(幅 320px)を足し、アクセシビリティの検査に「横にはみ出していない」と WCAG 2.2 AA を足す。はみ出した表(監査ログ)は、表の枠の中で横に動くようにした。

## 作業の前に読んだ物(ガイド)

- `apps/web/server/app.ts`: 入口は Hono。守りのヘッダー(secureHeaders)・`/assets/*` の静的ファイル(1年キャッシュ)・それ以外は全部 SSR。`/favicon.ico` も SSR に回り、TanStack Start が 404 の画面を描いていた
- `apps/web/server/index.ts`: `APP_ENV` は Sentry の環境の名前にだけ使っていた。stg・prod は Terraform が web にも `APP_ENV` を渡す(`envs/*/main.tf`)。**プレビューの web には渡していない**(`modules/preview-env`)ので、無いときは「本番ではない」扱いにする
- `apps/api/src/config.ts`: `APP_ENVS = local / test / preview / stg / prod`。名前はこれに合わせる
- `apps/web/playwright.config.ts`・`.github/workflows/ci.yml`: CI は `playwright install chromium` だけ。WebKit(iPhone)は入っていない。`ci.yml` は危険度「高」
- `apps/web/e2e/helpers.ts`: `expectAccessible` が axe(WCAG 2.1 AA まで)を回す。ほとんどの E2E がログインのたびに呼ぶ
- `packages/ui/src/components/Table.tsx`・`styles.css`: 表は `width: 100%` だけで、はみ出したときの枠が無い。入力欄は `min-width: 16rem`
- `apps/web/src/router.tsx`・`pages/ErrorPages.tsx`: 無い URL は `NotFoundPage`。SSR はすでに 404 を返していた(手元で確かめた)

## 1. 設計方針

- 検索の決まりは**画面のサーバー1か所**で付ける(画面ごとの `<meta name="robots">` にしない)。転送(302)・失敗(500)・静的なファイルにも漏れなく付き、画面を足した人が付け忘れない。
- **既定は全部 noindex、公開したいページだけ外す**(許す方を一覧にする)。業務アプリなので、載せたいページは少なく、付け忘れより外し忘れの方が安全。
- 本番かどうかは `APP_ENV === "prod"` だけで決める。値が無い・知らない値は本番ではない扱い(プレビューの web には `APP_ENV` が無い)。
- `public/` の物は、Vite がビルドで `dist/client` の直下に写す。画面のサーバーは起動のときに直下のファイルの一覧を作り、その名前のパスだけを返す(`/assets/*` と同じ `serveStatic`)。新しい依存は足さない。
- スマホの組は CI に今ある Chromium で回す(`ci.yml` を変えない)。
- 部品の直しは `packages/ui` の中だけ(画面に CSS を書かない決まりのまま)。

## 2. データモデル

該当なし(DB を触らない)。

## 3. API

該当なし(API を足さない・変えない)。画面のサーバーの応答だけが変わる:

| パス | 応答 | キャッシュ |
|---|---|---|
| 全部(`/healthz`・`/readyz` を除く) | `X-Robots-Tag: noindex, nofollow` を足す(本番で一覧にあるパスだけ付けない) | 変えない |
| `/robots.txt` | 本番: `User-agent: *` / `Disallow: /api/`。本番以外: `User-agent: *` / `Disallow: /` | 1時間 |
| `public/` の物(`/favicon.svg`) | ファイルの中身 | 1日(名前にハッシュが無いので短め) |
| 拡張子のあるパスで、`public/` に無いもの | `404 Not Found`(文字だけ。SSR に回さない) | — |

`/healthz`・`/readyz` は守りのヘッダーより前に置いてあり(ALB だけが叩く)、今回も付けない。

## 4. 状態遷移

該当なし(状態を持たない)。

## 5. システム間連携

- 検索の仕組み(Google など)が読むのは `X-Robots-Tag` と `robots.txt`。本番は `Disallow` にしない: `Disallow` にすると中身を読みに来ないので `noindex` も読まれず、よそのリンクから URL だけが載ることがある。本番以外は、念のため両方(読みに来ない+来ても載せない)。
- ZAP ベースライン(`preview.yml`)はプレビューを外から見る。今回のヘッダーで指摘が増えることは無い見込み。

## 6. 業務ルール

- 本番以外(`local`・`test`・`preview`・`stg`・値なし)は、一覧に関わらず全部の応答に noindex。
- 本番は、`INDEXABLE_PATHS`(`server/app.ts`)に書いたパスと**完全に同じ**パスだけ外す(前方一致にしない。`/login` を書いても `/login/xxx` は外れない)。いまは空。
- 拡張子のあるパス(最後の区切りに `.` がある)は、画面のパスではないと決める。画面のパスに `.` を使わない(`/projects/<UUID>` など、いまの画面はすべて当てはまる)。
- スマホの幅で、画面全体が横にはみ出さない。列の多い表は表の枠の中で横に動く。入力欄は狭い幅で親の幅まで縮む。
- 押す所は 24px 以上(WCAG 2.2 の 2.5.8)。`size="sm"` のボタンは約 32px で足りている。

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 本番以外は全部の応答に noindex | 3. API・6. 業務ルール | `server/app.test.ts`「本番以外(%s)は…全部に noindex」・「SSR の転送(302)と失敗(500)にも付く」・E2E `not-found.spec.ts` |
| 本番も既定は全部 noindex・一覧のパスだけ外す | 6. 業務ルール | `server/app.test.ts`「本番も既定は全部に noindex」・「本番で一覧に書いたページだけは外す」 |
| `/robots.txt`(本番以外は全部お断り・本番は API だけ) | 3. API・5. 連携 | `server/app.test.ts`「robots.txt: …」・E2E `not-found.spec.ts` |
| 静的なファイルの置き場と favicon | 1. 設計方針・3. API | `server/app.test.ts`「favicon は SSR に回さずに返す」・E2E `not-found.spec.ts` |
| 拡張子のあるパスで無いものは SSR に回さずに 404 | 3. API・6. 業務ルール | `server/app.test.ts`(SSR が呼ばれないこと) |
| 無い URL は 404 で「ページが見つかりません」 | (既存の `NotFoundPage`) | E2E `not-found.spec.ts`(パソコンとスマホの両方) |
| スマホの組で主な流れが通る | 10 の下の「スマホの組」 | `playwright.config.ts` の `mobile`(task-flow・audit・not-found) |
| どの画面でも横にはみ出さない | 6. 業務ルール | `e2e/helpers.ts` の `expectAccessible`(全部の E2E で) |
| WCAG 2.2 AA(target-size) | 6. 業務ルール | `e2e/helpers.ts` の `wcag22aa` |
| 表は枠の中で横に動く | 6. 業務ルール | E2E `audit.spec.ts`(スマホ。直す前は 378px > 320px で落ちた) |
| 入力欄は狭い幅で縮む | 6. 業務ルール | E2E `task-flow.spec.ts`(スマホ) |

### スマホの組

- 端末は Playwright の `Pixel 7`(Chromium・タッチ・スマホの UA)に、幅だけ **320px**(高さ 720px)を重ねる。320px は WCAG の reflow(1.4.10)の幅で、ここではみ出さなければ広いスマホも大丈夫。412px(Pixel 7 のまま)では何も落ちず、320px で監査ログの表が落ちた。
- 流すのは `task-flow.spec.ts`(ログイン → プロジェクト → タスク)・`audit.spec.ts`(5列の表)・`not-found.spec.ts` の3つ(5本)。全部を流すと E2E の時間がほぼ倍になる。
- `E2E_AUTH=cognito` のときはスマホの組を作らない(Cognito の流れはパソコンの幅だけ)。

## 8. 非機能

- 性能: `public/` の一覧は起動のときに1回だけ読む。拡張子のあるパスの探り(`/wp-login.php` など)が SSR と API の読みを動かさなくなるので、軽くなる。E2E はスマホの5本ぶん増える(手元で全体 1.1 分。CI では並びで +10 秒程度の見込み)。
- セキュリティ: 仕様の STRIDE のとおり。プレビュー・stg の URL が漏れても検索に載らない。本番のログインの後ろの画面も載らない。
- 運用: 本番で公開のページを載せたくなったら、`INDEXABLE_PATHS` にパスを足す(U-1)。`public/` にファイルを置けば、そのまま返る(再起動で一覧が変わる)。
- 費用: 無し。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離 | 該当なし(テナントの値を読まない) |
| 権限の表 | 該当なし(API を足さない) |
| 監査ログ | 該当なし(書き込みを足さない) |
| 解約で消す一覧 | 該当なし(表を足さない) |
| サポートの代理ログイン | 該当なし |
| ログの個人情報 | 該当なし(ログを足さない) |
| 画面の部品 | `Table` に横スクロールの枠(`.ui-table-scroll`)・`.ui-input` の `min-width` を `min(16rem, 100%)` に。`docs/design-system.md` に決まりを書いた |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 採用 | 画面のサーバー1か所で付ける・許す方を一覧にする。新しい依存なし |
| データモデル | 低優先 | DB を触らない |
| API | 低優先 | API を触らない |
| 状態遷移 | 低優先 | 状態を持たない |
| システム間連携 | 軽く確認 | 検索の仕組みとの約束(`Disallow` と `noindex` の組み合わせ) |
| 業務ルール | 採用 | 本番で何を検索に載せるか(U-1・事業判断)。作者 @attumkwg が「本番も全部載せない」で承認済み |
| 要求との対応 | 機械で検証 | 単体と E2E が受け入れ条件と1対1 |
| 非機能 | 軽く確認 | E2E の時間が少し延びる |
| 画面の部品 | 機械で検証 | E2E の axe と横はみ出しの検査が見る |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- **noindex は画面のサーバーで全部の応答に付ける**(画面ごとの meta にしない) — 転送・失敗・静的なファイルにも漏れず、画面を足した人が付け忘れない。
- **本番以外の判定は `APP_ENV === "prod"` でないこと** — プレビューの web には `APP_ENV` が無い。値が無いときに載る側に倒れないように。
- **本番の robots.txt は `Disallow: /api/` だけ** — 全部 `Disallow` にすると `noindex` が読まれない。API は画面ではないので辿らせない。
- **`public/` の物は起動のときの一覧のパスだけ返す**(何でも探しに行かない) — 画面のパスごとにファイルを探しに行かない。置き場の外は返さない。
- **拡張子のあるパスで無いものは SSR に回さずに 404** — `/favicon.ico` や探りの要求が、毎回 SSR と API の読みを動かしていた。画面のパスに `.` は無い。
- **favicon は SVG 1つ**(`/favicon.ico` は置かない) — 今のブラウザは `<link rel="icon">` の SVG を使う。ICO を作る道具を足さない。色は `--color-primary` と同じ値(SVG は CSS の変数を読めないので、ファイルの中に書く)。
- **スマホは Chromium の端末(Pixel 7)に幅 320px** — CI に WebKit を入れるのは `ci.yml` の変更(危険度「高」)で、時間も延びる。幅の検査は Chromium で足りる。iPhone(WebKit)は次の一歩。
- **スマホは主な流れの3ファイルだけ** — 全部を流すと E2E がほぼ倍。横のはみ出しは画面の形で決まるので、表・入力・一覧が出る画面を通せば足りる。
- **表のはみ出しは表の枠の中で横に動かす**(カードの形に組み替えない) — 部品1つの直しで済み、全部の表に効く。列を隠すかどうかは表ごとの判断が要る。
- **`size="sm"` のボタンは大きくしない** — 約 32px で WCAG 2.2 AA の 24px を満たす(axe の `target-size` が通る)。44px(AAA・Apple の目安)にすると一覧の行が太る。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|
| U-1 | 設計 | 事業判断 | 本番でも**全部のページを検索に載せない**(公開してよいページの一覧 `INDEXABLE_PATHS` は空)。ログイン・登録の画面も載らない | 業務アプリで、検索から来る人は少ない。載せたいページは後から一覧に1行足せば載る(逆に、一度載ったものを消すのは時間がかかる) | 本番のログイン・登録の画面(`/login`・`/sign-up`)を検索に載せるか(載せるなら一覧に足す) | 導入時に決める(キットの既定は @attumkwg 2026-10-22 に承認。2026-10-24 @attumkwg の回答でプロダクトごとに決める物にした) |

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
