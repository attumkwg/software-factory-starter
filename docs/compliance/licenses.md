# 依存のライセンスの一覧

> **生成物。手で直さない。** 正は [licenses.yaml](licenses.yaml)(決まり)と `pnpm-lock.yaml`(依存)。依存を足したら `pnpm deps:licenses --write`(作り忘れ・入れないライセンス・決まりに無いライセンスは CI が落とす)。
> 版の番号は書かない(Renovate が版を上げるたびに変わらないように)。版つきの全部の一覧(DD・審査・弁護士に渡す)は `pnpm deps:licenses --full <ファイル>.csv`。
> OS・CPU ごとの本体(`@esbuild/linux-x64` など)は除いた。手元と CI で入る物が違うため(中身は親と同じ作り手の物)。
> キット自身のライセンスは [MIT](../../LICENSE)。決まりの理由は [ADR 0083](../adr/0083-dependency-licenses.md)。キットから作ったプロダクトでは、売る前に専門家に確かめる([getting-started.md](../getting-started.md) の ②)。

## 1. まとめ(出てくるライセンスの種類)

| 分け方 | 意味 | 出てくる種類 |
|---|---|---|
| ✅ 許す | 表示を残せば、使う・配る・売るに制限が無い | (Apache-2.0 OR MIT)・0BSD・Apache-2.0・BSD-2-Clause・BSD-3-Clause・BlueOak-1.0.0・ISC・MIT・MIT OR Apache-2.0・MIT-0・Python-2.0・Unlicense |
| 🟡 注意 | 使ってよいが、条件がある。下の 2 に1件ずつ | CC-BY-4.0・FSL-1.1-Apache-2.0・MPL-2.0 |
| ❓ 決まりに無い | 下の 2 に1件ずつ確かめた | なし |
| ⛔ 入れない | MIT のキットと合わない(GPL・AGPL など) | なし |

## 2. 注意の物(1件ずつ、なぜ使ってよいか)

| パッケージ | ライセンス | 入る所 | なぜ使ってよいか |
|---|---|---|---|
| `@axe-core/playwright` | MPL-2.0 | 開発 | E2E のアクセシビリティの検査だけで使う(開発)。配る物にも画面にも入らない。直して配るときだけ、直したファイルを MPL で公開する |
| `axe-core` | MPL-2.0 | 開発 | 同上(@axe-core/playwright が使う)。配る物に入らない |
| `caniuse-lite` | CC-BY-4.0 | 本番 | ブラウザの対応表のデータで、build の道具(browserslist)が読む。画面の JS には入らない。データを配るなら出典の表示を残す |
| `lightningcss` | MPL-2.0 | 本番 | 画面の build で CSS を変換する道具(vite・TanStack Start が使う)。出てくる CSS は MPL にならない。直して配るときだけ、直したファイルを MPL で公開する |
| `sentry` | FSL-1.1-Apache-2.0 | 本番 | Sentry の CLI。@sentry/node が持つ(エラーの知らせ)。FSL は Sentry と競合する製品に使うことだけを禁じ、各版は2年で Apache-2.0 になる。会社向け SaaS を作る用途は当たらない |

## 3. 直接の依存(自分たちの package.json)

> 本番 = どれかの package.json の `dependencies` にある。開発 = `devDependencies` だけ。

| パッケージ | ライセンス | 入る所 | 使う所 |
|---|---|---|---|
| `@aws-sdk/client-cognito-identity-provider` | Apache-2.0 | 本番 | apps/api・packages/fake-cognito |
| `@aws-sdk/client-kms` | Apache-2.0 | 本番 | apps/api |
| `@aws-sdk/client-s3` | Apache-2.0 | 本番 | apps/api |
| `@aws-sdk/client-sts` | Apache-2.0 | 本番 | apps/api |
| `@aws-sdk/s3-request-presigner` | Apache-2.0 | 本番 | apps/api |
| `@axe-core/playwright` | MPL-2.0 | 開発 | apps/web |
| `@biomejs/biome` | MIT OR Apache-2.0 | 開発 | (ルート) |
| `@hono/node-server` | MIT | 本番 | apps/api・apps/web |
| `@hono/zod-openapi` | MIT | 本番 | apps/api |
| `@playwright/test` | Apache-2.0 | 開発 | apps/web |
| `@sentry/browser` | MIT | 本番 | apps/web |
| `@sentry/node` | MIT | 本番 | packages/error-reporting |
| `@tanstack/react-router` | MIT | 本番 | apps/web |
| `@tanstack/react-start` | MIT | 本番 | apps/web |
| `@testcontainers/postgresql` | MIT | 開発 | apps/api |
| `@types/node` | MIT | 開発 | apps/api・apps/site・apps/web・packages/error-reporting・packages/fake-cognito・packages/logging |
| `@types/nodemailer` | MIT | 開発 | apps/api |
| `@types/pg` | MIT | 開発 | apps/api |
| `@types/react` | MIT | 開発 | apps/site・apps/web・packages/ui・prototypes/B-0002-morning-digest |
| `@types/react-dom` | MIT | 開発 | apps/site・apps/web・packages/ui・prototypes/B-0002-morning-digest |
| `@vitejs/plugin-react` | MIT | 開発 | apps/site・apps/web・prototypes/B-0002-morning-digest |
| `@vitest/coverage-v8` | MIT | 開発 | (ルート) |
| `drizzle-kit` | MIT | 開発 | apps/api |
| `drizzle-orm` | Apache-2.0 | 本番 | apps/api |
| `esbuild` | MIT | 開発 | apps/api・apps/web |
| `hono` | MIT | 本番 | apps/api・apps/web |
| `jose` | MIT | 本番 | apps/api |
| `nodemailer` | MIT-0 | 本番 | apps/api |
| `pg` | MIT | 本番 | apps/api |
| `pino` | MIT | 本番 | apps/api・apps/web・packages/logging |
| `react` | MIT | 本番 | apps/site・apps/web・packages/ui・prototypes/B-0002-morning-digest |
| `react-aria-components` | Apache-2.0 | 本番 | packages/ui |
| `react-dom` | MIT | 本番 | apps/site・apps/web・packages/ui・prototypes/B-0002-morning-digest |
| `squawk-cli` | (Apache-2.0 OR MIT) | 開発 | apps/api |
| `testcontainers` | MIT | 開発 | apps/api |
| `tsx` | MIT | 開発 | apps/api |
| `turbo` | MIT | 開発 | (ルート) |
| `typescript` | Apache-2.0 | 開発 | (ルート) |
| `uqr` | MIT | 本番 | packages/ui |
| `uuid` | MIT | 本番 | apps/api |
| `vite` | MIT | 開発 | apps/site・apps/web・prototypes/B-0002-morning-digest |
| `vitest` | MIT | 開発 | apps/api・apps/site・apps/web・packages/error-reporting・packages/fake-cognito・packages/logging・packages/shared |
| `yaml` | ISC | 開発 | (ルート)・apps/api |
| `zod` | MIT | 本番 | apps/api・packages/shared |
