# 画面の見た目を比べる(VRT)と、PR に貼るスクショ

> 主な画面を撮って、前の見た目(基準の画像)と比べる。違えば CI が落ち、PR のコメントに「どの画面が変わったか」と画面の一覧が出る。
> 決めた理由: [ADR 0024](../adr/0024-vrt-browser-in-docker.md)・[設計書 0011](../designs/0011-visual-regression.md)

## 何があるか

| 物 | 場所 |
|---|---|
| 撮る画面の一覧(足す・消すはここ) | `apps/web/e2e/vrt/screens.ts` |
| 撮って比べるテスト | `apps/web/e2e/vrt/screens.spec.ts`(設定は `apps/web/playwright.vrt.config.ts`) |
| 基準の画像(コミットする) | `apps/web/e2e/vrt/__screenshots__/desktop/`(幅 1280px)・`mobile/`(幅 390px) |
| ブラウザ(Docker の中の Chromium) | `docker-compose.vrt.yml` |
| CI | `.github/workflows/vrt.yml`(PR ごと。結果は PR のコメント1つ) |
| 部品の一覧ページ(これも撮る) | `/design-system`(本番では出ない) |

**ブラウザだけを Docker の中で動かす**のがこの仕組みの芯。文字の描き方は OS で変わるので、Windows・Mac・CI(Linux)で撮るとそれだけで画像が違う。いつも同じイメージの中の Chromium で撮るので、どこで流しても同じ画像になる。

## 手元で比べる

```bash
docker compose up --build -d
```

```bash
docker compose -f docker-compose.vrt.yml up -d --wait
```

```bash
pnpm vrt
```

- 1行目はアプリ(E2E と同じ)、2行目はブラウザ。ブラウザは一度立てれば、止めるまで使い回せる(止めるのは `docker compose -f docker-compose.vrt.yml down`)。
- 違ったら `apps/web/test-results-vrt/<画面>-<組>/` に `-expected.png`(基準)・`-actual.png`(今回)・`-diff.png`(違う所が赤)が出る。
- **種データだけの DB で撮る**。手元で E2E を流した後でも、ログインの後ろの画面は Globex(E2E が書き込まない組織)で撮るので、たいていはそのまま比べられる。おかしければ `docker compose down -v` してから起動し直す(手元の DB の中身は消える)。

## 基準を変える(画面を変えたとき)

基準の画像は「変える」と決めたときだけ変える。やり方は2つ。

**手元で(Docker がある)**:

```bash
pnpm vrt:update
```

撮り直した画像が `__screenshots__` に入る。**画像を開いて、意図どおりかを見てから**コミットする。

**GitHub だけで(手元に Docker が無い)**: PR にラベル `vrt:update` を付ける。CI が撮り直し、PR のコメントに取り込む1行(`gh run download …`)が出る。PR のブランチでそれを流し、画像を見てコミットし、ラベルを外す。**コミットするまで VRT の検査は赤のまま**(CI は自分で push しない)。

どちらでも、PR の「Files changed」で GitHub が前と後の画像を並べて見せる(Swipe・Onion skin)。PR の「📸 スクショ」には、どの画面をなぜ変えたかを1行書く。

## 撮る画面を足す・消す

1. `apps/web/e2e/vrt/screens.ts` の `SCREENS` に1行足す(URL・待つ見出し・ログインが要るなら `as`)。
2. `pnpm vrt:update` → 足した画像を開いて見る → コミット。
3. 消すときは、行と一緒に `__screenshots__/desktop/<id>.png`・`mobile/<id>.png` も消す。

写してよいのは**種データ(架空の2社・`.test` のメール)と固定の文だけ**。公開のリポジトリでは、基準の画像も PR のコメントも誰でも見られる。

- 日によって変わる文字(作った日などの `2026/10/24` の形)は、テストが灰色に塗る。ほかに変わる値(時刻・件数・乱数)が写る画面は、`mask` を足すか撮らない。
- 書き込む操作はしない(見るだけ)。ログインの後ろの画面は Globex の管理者で撮る。
- 撮らない画面と理由は `screens.ts` の頭に書いてある(監査ログ・アカウント・登録・パスワードの再設定・サポート・同意)。

## 何も変えていないのに落ちる(揺れ)

1. まず `-diff.png` を見る。赤い所が「毎回変わる値」なら、その部分を `mask` で塗る。
2. 読み込みの途中を撮っていそうなら、`screens.spec.ts` で待つ物を足す(見出しだけでなく、表の行など)。
3. それでも数画素ぶれるなら、その画面だけ `toHaveScreenshot` に `maxDiffPixels` を足す(全体の設定は 0 のまま)。
4. ブラウザの版がずれていないか: `apps/web` の `@playwright/test`・`docker-compose.vrt.yml` のイメージのタグと `playwright@` の3つは同じ版。ずれると単体テスト(`e2e/vrt/versions.test.ts`)が落ちる。Renovate はまとめて上げる。上げたら `pnpm vrt:update` で基準を撮り直す(Chromium の版が変わると、文字の描き方が少し変わることがある)。

## PR のコメント

`vrt.yml` が PR に1つだけコメントを付け、push のたびに書き換える。

- ✅ 基準と同じ / ❌ 違う画面の一覧と、基準・今回・差分の画像の入った成果物 `vrt-diff`(14日)へのリンク / 🔁 ラベルで撮り直した画像と取り込む1行
- 「主な画面」を開くと、パソコンとスマホの画面が並ぶ(PR の先頭の commit の基準の画像)
- フォーク(外の人)からの PR にはコメントしない(書き込みの権限を渡さない)。比べる検査は流れる

## 最初にやる設定(人)

- ラベル `vrt:update` を作る(Settings → Labels。README の「本人が手でやる設定」の 2)
- ブランチ保護の必須のチェックに `見た目の比べ(VRT)` を足す(README の 1)。足さなければ、赤でもマージできる(知らせるだけ)
