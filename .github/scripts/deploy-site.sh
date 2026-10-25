#!/usr/bin/env bash
# 公開の LP(apps/site)をビルドして S3 に置き、CloudFront の古い物を消す(docs/guides/landing-page.md)。
#   deploy-site.sh <SITE_ENV(stg|prod)> <公開の LP の URL> <画面と API の URL> <バケット> <CloudFront の ID>
# 中身は静的なファイルだけ(秘密も個人情報も無い)。HTML は毎回確かめさせ、名前にハッシュの付いた JS・CSS は長く持たせる。
set -euo pipefail
site_env=$1 site_url=$2 app_url=$3 bucket=$4 distribution=$5

SITE_ENV="$site_env" SITE_URL="$site_url" APP_URL="$app_url" pnpm --filter @app/site build
dist=apps/site/dist

aws s3 sync "$dist/assets" "s3://$bucket/assets" --delete \
  --cache-control "public, max-age=31536000, immutable"
aws s3 sync "$dist" "s3://$bucket" --delete --exclude "assets/*" \
  --cache-control "public, max-age=0, must-revalidate"
aws cloudfront create-invalidation --distribution-id "$distribution" --paths "/*" \
  --query Invalidation.Id --output text
