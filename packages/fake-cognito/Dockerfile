# syntax=docker/dockerfile:1
# 開発とテスト専用の偽物の Cognito(docker compose の fake-cognito)。**本番には出さない**。
# 依存は Node の標準だけなので、ソースを置いて Node の型の取り除き(type stripping)でそのまま動かす。
# Cognito の設定(パスワードの決まりなど)は packages/shared の cognito-settings.json を読む(Terraform と同じ物)。
FROM node:24-trixie-slim
WORKDIR /app
COPY packages/shared/src/cognito-settings.json packages/shared/src/cognito-settings.json
COPY packages/fake-cognito/src packages/fake-cognito/src
USER node
EXPOSE 9231
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD ["node", "-e", "fetch('http://localhost:9231/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "packages/fake-cognito/src/server.ts"]
