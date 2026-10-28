#!/usr/bin/env bash
# クラウドの Claude Code(Slack から頼んだ作業が動く所)の環境の「準備の手順」に貼る物(docs/guides/slack.md の 🧍)。
# 何度流しても同じ。できない物は止めずに書き出し、最後に「何が動くか」を1行ずつ出す(AI がそれを見て、流すテストを決める)。
#   Node 24(.node-version)・pnpm(packageManager)・依存・Docker(結合テストの testcontainers と E2E)
set -uo pipefail
cd "$(dirname "$0")/.."
want=$(sed 's/^v//' .node-version)

# Node: クラウドの既定は 22 まで。24 が無ければ nvm か n で入れる(nodejs.org に出られる網のときだけ)
if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" != "${want%%.*}" ]; then
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm install "$want" >/dev/null && nvm alias default "$want" >/dev/null
  else
    npx -y n "$want" >/dev/null 2>&1 || sudo -n npx -y n "$want" >/dev/null 2>&1
  fi
fi

corepack enable >/dev/null 2>&1 || npm install -g "$(node -p 'require("./package.json").packageManager')" >/dev/null 2>&1
pnpm install --frozen-lockfile >/dev/null 2>&1 && deps=ok || deps=ng

# Docker: 入っていて起きていなければ起こす(30秒待つ)
if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
  (sudo -n dockerd >/tmp/dockerd.log 2>&1 &) 2>/dev/null || (dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi

echo "Node: $(node --version 2>/dev/null || echo 無い)(欲しいのは v$want)"
echo "依存: $deps"
if docker info >/dev/null 2>&1; then
  echo "Docker: 動く(pnpm test:integration と E2E を流せる)"
else
  echo "Docker: 動かない(結合と E2E は CI に任せる。/tmp/dockerd.log)"
fi
