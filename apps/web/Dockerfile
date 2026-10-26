# syntax=docker/dockerfile:1
# リポジトリのルートを文脈にして作る: docker build -f apps/web/Dockerfile .
# 画面のサービス(TanStack Start の SSR)。API とは別のイメージ・別の ECS サービス。本番もプレビューも同じイメージ。

FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS build
# 外への通信を絞った devcontainer の中で作るとき、corepack と pnpm(Node の fetch)にプロキシを使わせる。
# 空のとき(CI・本番)は何も変わらない(docs/designs/0057-ai-egress.md の 5 ①)
ARG NODE_USE_ENV_PROXY
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/error-reporting/package.json packages/error-reporting/
COPY packages/logging/package.json packages/logging/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
# 画面と、画面が使うパッケージの依存だけを入れる
RUN pnpm install --frozen-lockfile --filter "@app/web..."
COPY tsconfig.base.json ./
COPY packages/error-reporting packages/error-reporting
COPY packages/logging packages/logging
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/web apps/web
RUN pnpm --filter @app/web build

# 実行用: シェルもパッケージ管理も無い distroless(攻撃面と Trivy の指摘を減らす)。root では動かさない。
# 中身は「1つにまとめた JS(index.js)」と「配る JS・CSS(client/)」だけ。node_modules も DB の接続も無い。
FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001
COPY --from=build /repo/apps/web/dist/index.js /repo/apps/web/dist/index.js.map ./
COPY --from=build /repo/apps/web/dist/client ./client
USER nonroot
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://localhost:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["--enable-source-maps", "index.js"]
