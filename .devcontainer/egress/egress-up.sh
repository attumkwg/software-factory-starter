#!/usr/bin/env bash
# 外への通信を絞る(docs/designs/0057-ai-egress.md の 5 ①・ADR 0068)。root で動く。
# 開発の利用者 node が sudo で動かせるのは、この台本だけ(.devcontainer/Dockerfile)。何度流しても同じになる(絞るだけ)。
#
#   外へ出られるのは、許可リストのプロキシ(利用者 tinyproxy)だけ。ほかの通信は止まる(REJECT)。
#   このコンテナの中(localhost)・中の Docker の網(結合テストの DB・E2E の画面)へは通る。
#   中の Docker のコンテナからは外へ出られない(取得とビルドはプロキシを通る)。
#   最初の起動で、node のふつうの sudo を取り上げる(この台本だけ残す)。
set -euo pipefail

DIR=/usr/local/share/egress
PORT=3128

# ── 1. 許可リストのプロキシ ─────────────────────────────────────────────
grep -v '^[[:space:]]*#' "$DIR/allowlist.txt" | sed '/^[[:space:]]*$/d' >/etc/tinyproxy/filter
cp "$DIR/tinyproxy.conf" /etc/tinyproxy/tinyproxy.conf
mkdir -p /var/log/tinyproxy /run/tinyproxy
touch /var/log/tinyproxy/tinyproxy.log
chown -R tinyproxy:tinyproxy /var/log/tinyproxy /run/tinyproxy
# 止まった宛先を、node も読めるように(blocked.sh)
chmod 755 /var/log/tinyproxy
chmod 644 /var/log/tinyproxy/tinyproxy.log
pkill -x tinyproxy 2>/dev/null || true
sleep 0.5
tinyproxy -c /etc/tinyproxy/tinyproxy.conf

# 中の Docker で作る・動かすコンテナに渡すプロキシ(宛先は中の Docker の網の、このコンテナの側の IP。
# このコンテナ自身の網と重ならないよう、中の Docker の網は毎回違うことがある)
for _ in $(seq 1 30); do ip -4 addr show docker0 >/dev/null 2>&1 && break; sleep 1; done
GATEWAY=$(ip -4 addr show docker0 2>/dev/null | awk '/inet /{split($2, a, "/"); print a[1]; exit}')
if [ -n "$GATEWAY" ]; then
  mkdir -p /home/node/.docker
  sed "s/__GATEWAY__/$GATEWAY/g" "$DIR/docker-client.json" >/home/node/.docker/config.json
  chown -R node:node /home/node/.docker
fi

# ── 2. firewall(IPv4)────────────────────────────────────────────────
PROXY_UID=$(id -u tinyproxy)
iptables -N EGRESS 2>/dev/null || iptables -F EGRESS
iptables -A EGRESS -o lo -j ACCEPT
iptables -A EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# 中の Docker の網へ(結合テストの DB・E2E の画面・ブラウザ)
iptables -A EGRESS -o docker0 -j ACCEPT
iptables -A EGRESS -o br-+ -j ACCEPT
# 外へ出られるのはプロキシだけ(名前を引く・宛先へつなぐ)
iptables -A EGRESS -m owner --uid-owner "$PROXY_UID" -j ACCEPT
iptables -A EGRESS -j REJECT --reject-with icmp-port-unreachable
iptables -C OUTPUT -j EGRESS 2>/dev/null || iptables -I OUTPUT 1 -j EGRESS

# 中の Docker のコンテナから外へ(転送)は止める。網どうし・このコンテナ(プロキシ)へは通る
if iptables -L DOCKER-USER >/dev/null 2>&1; then
  OUT_IF=$(ip route show default | awk '{print $5; exit}')
  iptables -C DOCKER-USER -o "$OUT_IF" -m conntrack --ctstate NEW -j REJECT 2>/dev/null \
    || iptables -I DOCKER-USER 1 -o "$OUT_IF" -m conntrack --ctstate NEW -j REJECT
fi

# ── 3. firewall(IPv6。外へは出さない) ────────────────────────────────
if command -v ip6tables >/dev/null 2>&1 && ip6tables -L OUTPUT >/dev/null 2>&1; then
  ip6tables -N EGRESS 2>/dev/null || ip6tables -F EGRESS
  ip6tables -A EGRESS -o lo -j ACCEPT
  ip6tables -A EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip6tables -A EGRESS -j REJECT
  ip6tables -C OUTPUT -j EGRESS 2>/dev/null || ip6tables -I OUTPUT 1 -j EGRESS
fi

# ── 4. node のふつうの sudo を取り上げる(この台本だけ残す) ──────────────
rm -f /etc/sudoers.d/node

echo "外への通信を絞りました(許可リスト: $(wc -l </etc/tinyproxy/filter) 件・プロキシ: 127.0.0.1:$PORT)"
