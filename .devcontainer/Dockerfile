# 人も AI も同じ開発環境。外への通信は許可リストのプロキシだけ(docs/designs/0057-ai-egress.md の 5 ①・ADR 0068)。
# 絞りは起動のたびに egress/egress-up.sh(root)が入れる。ここでは、絞った後に要らなくなる物を先に入れておく。
FROM mcr.microsoft.com/devcontainers/typescript-node:24-bookworm

# 許可リストのプロキシと、firewall の道具
RUN apt-get update \
  && apt-get install -y --no-install-recommends tinyproxy iptables iproute2 \
  && rm -rf /var/lib/apt/lists/* \
  && systemctl disable tinyproxy 2>/dev/null || true

# E2E のブラウザと、それが要る OS の部品を、作るときに入れる。絞った後は apt が外へ出られず、
# ブラウザの置き場(storage.googleapis.com。だれでも使える保存先)を許可リストに入れたくないため。
# 版は apps/web の @playwright/test と同じ(apps/web/e2e/vrt/versions.test.ts が見張る)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@1.64.0 install --with-deps chromium \
  && chmod -R a+rX /ms-playwright \
  && rm -rf /root/.npm

# 絞りの台本と許可リスト。root の持ち物(開発の利用者 node は書けない)
COPY egress/ /usr/local/share/egress/
RUN chmod 755 /usr/local/share/egress/*.sh \
  && chmod 644 /usr/local/share/egress/allowlist.txt /usr/local/share/egress/tinyproxy.conf \
  && mkdir -p /etc/docker \
  && cp /usr/local/share/egress/docker-daemon.json /etc/docker/daemon.json \
  # node が sudo で動かせるのは、絞りの台本だけ(ほかの sudo は egress-up.sh が最初の起動で取り上げる)
  && echo 'node ALL=(root) NOPASSWD: /usr/local/share/egress/egress-up.sh' > /etc/sudoers.d/egress \
  && chmod 440 /etc/sudoers.d/egress \
  # 中の Docker で作る・動かすコンテナにもプロキシを渡す(取得とビルドの pnpm install)。宛先は egress-up.sh が起動のたびに書く
  && mkdir -p /home/node/.docker \
  && chown -R node:node /home/node/.docker
