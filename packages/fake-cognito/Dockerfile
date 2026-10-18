# syntax=docker/dockerfile:1
# 開発とテスト専用の偽物の Cognito(docker compose の fake-cognito)。**本番には出さない**。
# 依存は Node の標準だけなので、ソースを置いて Node の型の取り除き(type stripping)でそのまま動かす。
FROM node:24-trixie-slim
WORKDIR /app
COPY packages/fake-cognito/src ./src
USER node
EXPOSE 9231
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD ["node", "-e", "fetch('http://localhost:9231/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.ts"]
