#!/usr/bin/env bash
# 許可リストのプロキシが止めた宛先を、多い順に出す(docs/designs/0057-ai-egress.md の 3)。
# 足すかどうかは人が決め、足すなら allowlist.txt を直す PR(危険度「高」)。
# プロキシを通さずに外へ出ようとした通信は、その場で止まり(接続の失敗)、ここには出ない。
set -euo pipefail
LOG=/var/log/tinyproxy/tinyproxy.log
if [ ! -r "$LOG" ]; then
  echo "記録がありません($LOG)。絞りが入っていない(egress-up.sh がまだ流れていない)かもしれません"
  exit 0
fi
grep -i 'filtered' "$LOG" | grep -oE '"[^"]+"' | tr -d '"' | sed -E 's#^[a-z]+://##; s#[:/].*##' | sort | uniq -c | sort -rn || echo "止めた宛先はありません"
