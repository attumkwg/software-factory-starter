#!/usr/bin/env bash
# 手元と同じ形のアプリ(DB・移行・種データ・API・画面の SSR・ALB の代わり)と、Docker の中のブラウザ
# (Playwright の公式イメージ。docker-compose.vrt.yml)を並べて起動する。E2E と VRT が使う。
# ブラウザを Docker の中にするので、ホストに OS の部品(apt)もブラウザも入れない(取得が10分かかることがあった)。
# 段ごとに時刻と、始めてからの秒数を出す。遅いときに、どの段かがログだけで分かるように。失敗したら中のログを出す。
#   使い方: bash .github/scripts/start-app.sh [--with-fake-cognito]
#   つなぎ方: テストの側で E2E_WS_ENDPOINT(VRT は VRT_WS_ENDPOINT)= ws://127.0.0.1:3100/
set -euo pipefail

start=$(date +%s)
log() { echo "[$(date -u +%H:%M:%S) +$(($(date +%s) - start))s] $*"; }
logs_dir="${RUNNER_TEMP:-/tmp}"

log "ブラウザ(Docker の中の Chromium)を裏で起動する(イメージは約1.5GB)"
docker compose -f docker-compose.vrt.yml up -d --wait >"$logs_dir/browser.log" 2>&1 &
browser=$!

if [ "${1:-}" = "--with-fake-cognito" ]; then
  # 後の Cognito の手順で使う偽物の Cognito も作っておく(コンテナの外への通信を止めた後では作れない)
  log "偽物の Cognito のイメージを作る"
  echo "::group::偽物の Cognito を作る"
  docker compose -f docker-compose.yml -f docker-compose.cognito.yml build fake-cognito
  echo "::endgroup::"
fi

log "アプリのイメージを作って起動する"
echo "::group::アプリを作って起動する(docker compose up --build)"
docker compose up --build -d
echo "::endgroup::"

# alb(ALB の代わり)の向こうで、画面(/readyz が 200)と API(/api/me がログイン前なので 401)の両方が答えるまで。
# 1回の確かめは2秒で切り、10回ごとに今の答えを出す
log "アプリが答えるのを待つ"
ready=false
for i in $(seq 1 120); do
  web=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://localhost:8080/readyz || true)
  api=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://localhost:8080/api/me || true)
  if [ "$web" = "200" ] && [ "$api" = "401" ]; then
    ready=true
    break
  fi
  if [ $((i % 10)) -eq 0 ]; then log "まだ: 画面 /readyz=$web・API /api/me=$api"; fi
  sleep 1
done
if [ "$ready" != true ]; then
  log "アプリが答えなかった。中のログを出す"
  docker compose ps
  docker compose logs --tail 200
  exit 1
fi
log "アプリが答えた"

log "ブラウザの起動を待つ"
if ! wait "$browser"; then
  log "ブラウザが起動しなかった"
  cat "$logs_dir/browser.log"
  exit 1
fi
log "ブラウザが起動した"

echo "::group::起動したコンテナ"
docker compose ps
docker compose -f docker-compose.vrt.yml ps
echo "::endgroup::"
log "起動の合計: $(($(date +%s) - start))秒"
