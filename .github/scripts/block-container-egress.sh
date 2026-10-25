#!/usr/bin/env bash
# Actions の中の Docker のコンテナから、外への新しい通信を止める(docs/designs/0057-ai-egress.md の 5 ②・段4。U-2)。
# 結合テストの DB などのコンテナは外へ出られない。イメージの取得は Docker 本体(このホスト)がするので通る。
# コンテナどうし・このホストのテストの本体からコンテナへは通る。外の会社の部品は使わない(U-2)。
# 使う所: claude.yml(背景の AI が結合テストを回す前)・ci.yml(結合テスト・E2E の前。段4)。
set -euo pipefail

OUT_IF=$(ip route show default | awk '{print $5; exit}')
if [ -z "$OUT_IF" ]; then
  echo "::error::外へつながる網が分かりません(ip route show default)"
  exit 1
fi
if ! sudo iptables -L DOCKER-USER >/dev/null 2>&1; then
  echo "::error::DOCKER-USER の鎖がありません(Docker が動いていない)"
  exit 1
fi
sudo iptables -C DOCKER-USER -o "$OUT_IF" -m conntrack --ctstate NEW -j REJECT 2>/dev/null \
  || sudo iptables -I DOCKER-USER 1 -o "$OUT_IF" -m conntrack --ctstate NEW -j REJECT
if sudo ip6tables -L DOCKER-USER >/dev/null 2>&1; then
  sudo ip6tables -C DOCKER-USER -o "$OUT_IF" -m conntrack --ctstate NEW -j REJECT 2>/dev/null \
    || sudo ip6tables -I DOCKER-USER 1 -o "$OUT_IF" -m conntrack --ctstate NEW -j REJECT
fi
echo "Docker のコンテナから外($OUT_IF)への新しい通信を止めました"
