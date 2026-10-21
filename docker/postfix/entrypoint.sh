#!/bin/sh
# Postfix を、環境変数から作った設定で起動する(前で動かし、ログは標準出力へ)。
#
#   POSTFIX_RELAYHOST        … 渡す先。本番 [email-smtp.ap-northeast-1.amazonaws.com]:587 / 手元 [mailpit]:1025
#   POSTFIX_RELAY_TLS        … encrypt(TLS が無ければ渡さない。本番)/ none(手元)
#   POSTFIX_RELAY_USERNAME / POSTFIX_RELAY_PASSWORD … SES の SMTP の資格情報(本番。Secrets Manager から)
#   POSTFIX_MYNETWORKS       … 受け取ってよい送り手(本番は VPC の範囲。ほかからの中継は断る)
#   POSTFIX_SENDER_DOMAINS   … 送り元として許すドメイン(カンマ区切り。SES で確かめたドメインだけ)
#   POSTFIX_MYHOSTNAME       … この中継の名前
set -eu

: "${POSTFIX_RELAYHOST:?POSTFIX_RELAYHOST が要ります}"
: "${POSTFIX_MYNETWORKS:?POSTFIX_MYNETWORKS が要ります}"
: "${POSTFIX_SENDER_DOMAINS:?POSTFIX_SENDER_DOMAINS が要ります}"
tls="${POSTFIX_RELAY_TLS:-encrypt}"

conf=/run/postfix/conf
mkdir -p "$conf"
cp /etc/postfix/main.cf /etc/postfix/master.cf "$conf/"
cp -r /etc/postfix/sasl "$conf/" 2>/dev/null || true

# 送り元として許すドメイン(ほかのドメインを名乗るメールは受け取らない)
: > "$conf/sender_access"
for d in $(echo "$POSTFIX_SENDER_DOMAINS" | tr ',' ' '); do
  printf '%s OK\n' "$d" >> "$conf/sender_access"
done

pc() { postconf -c "$conf" -e "$@"; }

pc "myhostname = ${POSTFIX_MYHOSTNAME:-mail-relay.internal}"
pc "inet_interfaces = all" "inet_protocols = ipv4"
# このサーバーには誰の受信箱も無い(中継だけ)
pc "mydestination =" "local_recipient_maps =" "local_transport = error:local delivery is disabled"
pc "alias_maps =" "alias_database ="
# 受け取ってよいのは mynetworks から・許したドメインを名乗るものだけ。それ以外の中継は断る
pc "mynetworks = ${POSTFIX_MYNETWORKS}"
pc "smtpd_relay_restrictions = permit_mynetworks, reject"
pc "smtpd_recipient_restrictions = permit_mynetworks, reject"
pc "smtpd_sender_restrictions = check_sender_access texthash:${conf}/sender_access, reject"
pc "smtpd_tls_security_level = none"
pc "message_size_limit = 10485760"
# 渡す先
pc "relayhost = ${POSTFIX_RELAYHOST}"
pc "smtp_tls_security_level = ${tls}" "smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt"
pc "smtp_tls_loglevel = 1"
if [ -n "${POSTFIX_RELAY_USERNAME:-}" ]; then
  umask 077
  printf '%s %s:%s\n' "$POSTFIX_RELAYHOST" "$POSTFIX_RELAY_USERNAME" "${POSTFIX_RELAY_PASSWORD:?POSTFIX_RELAY_PASSWORD が要ります}" \
    > "$conf/sasl_passwd"
  umask 022
  pc "smtp_sasl_auth_enable = yes" "smtp_sasl_password_maps = texthash:${conf}/sasl_passwd"
  pc "smtp_sasl_security_options = noanonymous" "smtp_sasl_tls_security_options = noanonymous"
fi
# 送り待ちの置き場所(本番は EFS)。止まっていた間に溜まった物も、起動したら送り直す
pc "queue_directory = /var/spool/postfix" "data_directory = /var/spool/postfix/data"
# 渡せないときは5日までやり直す(SES の一時的な止まり・流量の上限に耐える)
pc "maximal_queue_lifetime = 5d" "bounce_queue_lifetime = 1d"
# ログは標準出力へ(CloudWatch Logs / docker compose logs)。メールアドレス(to=<…>・from=<…>)は伏せてから出す
# (docs/specs/0008-personal-data.md の B)。Postfix は名前付きのパイプに書き、sed が置き換えて標準出力へ流す
# (<> で読み書きの両方で開く: 書く側が開き直しても、sed が終わりと見なして止まらないように)
logpipe=/run/postfix/maillog.pipe
rm -f "$logpipe"
mkfifo -m 600 "$logpipe"
# message-id の行だけはそのまま(アプリが決めた <出来事.ID@ホスト> で、API のログの messageId と突き合わせる)
sed -u -E '/: message-id=</!s/[^][<>()[:space:],;:"]+@[^][<>()[:space:],;:"]+/[email]/g' <> "$logpipe" &
pc "maillog_file_prefixes = /var, /dev/stdout, /run/postfix" "maillog_file = ${logpipe}"
# コンテナの中では chroot しない(chroot の中に要るファイルを用意しないため)
postconf -c "$conf" -F '*/*/chroot = n'

mkdir -p /var/spool/postfix/data
# 送り待ちの持ち主と権限を整える(EFS を初めて付けたとき・入れ替わったとき)
postfix -c "$conf" set-permissions >/dev/null 2>&1 || true
postfix -c "$conf" check

echo "Postfix を起動します(渡す先: ${POSTFIX_RELAYHOST} / TLS: ${tls})"
exec postfix -c "$conf" start-fg
