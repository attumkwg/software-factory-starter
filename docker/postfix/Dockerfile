# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# メールの中継(Postfix)。アプリ → ここ → 本番は SES / 手元は Mailpit。docs/guides/mail.md
# リポジトリのルートを文脈にして作る: docker build -f docker/postfix/Dockerfile .
#
# 本番(ECS)では読み取り専用のファイルシステムで動く。書くのは次の2か所だけ:
#   /var/spool/postfix … 送り待ち。本番は EFS(Postfix が入れ替わっても消えない)
#   /run/postfix       … 起動のたびに作る設定(SES のパスワードを含むので、ディスクに残さない)
# Postfix の master は root で起動する作り(25番を開き、送り待ちの持ち主を整え、各処理は postfix のユーザーに下がる)。
# root のままなのは master だけ。受け取り・配送の処理は postfix のユーザーで動く(Trivy の除外は .trivyignore.yaml)
FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    postfix libsasl2-modules ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  # 起動時に作る設定の置き場所を、Postfix に前もって教える
  && postconf -e "alternate_config_directories = /run/postfix/conf"

COPY --chmod=755 docker/postfix/entrypoint.sh /usr/local/bin/postfix-entrypoint

EXPOSE 25
# master は root で起動し、各処理は postfix のユーザーに下がる(Postfix の作り)
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD ["postfix", "-c", "/run/postfix/conf", "status"]
ENTRYPOINT ["postfix-entrypoint"]
