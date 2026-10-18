# syntax=docker/dockerfile:1
# リポジトリのルートを文脈にして作る: docker build -f apps/api/Dockerfile .
# 1つのイメージで API と移行(cli.js migrate)をまかなう。本番もプレビューも同じイメージ。
# 画面は別のイメージ(apps/web/Dockerfile)。

FROM node:24-trixie-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/error-reporting/package.json packages/error-reporting/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
# API と、API が使うパッケージの依存だけを入れる
RUN pnpm install --frozen-lockfile --filter "@app/api..."
COPY tsconfig.base.json ./
COPY packages/error-reporting packages/error-reporting
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @app/api build

# 実行用: シェルもパッケージ管理も無い distroless(攻撃面と Trivy の指摘を減らす)。root では動かさない。
FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /app
# Aurora へは TLS で、証明書も確かめる(sslmode=verify-full)。RDS の CA を Node に足す
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    MIGRATIONS_DIR=/app/drizzle \
    WEB_DIST_DIR=./web \
    PORT=3000
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
# 使い捨ての DB(プレビュー)で接続ユーザーを作る SQL(cli.js init-roles)
COPY --from=build /repo/apps/api/db/init ./db/init
USER nonroot
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["--enable-source-maps", "dist/index.js"]
