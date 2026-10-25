variable "project" {
  description = "名前の頭"
  type        = string
  default     = "sfs"
}

variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "github_repository" {
  description = "owner/repo"
  type        = string
  default     = "attumkwg/software-factory-starter"
}

variable "create_oidc_provider" {
  description = "このアカウントに GitHub の OIDC プロバイダーがまだ無ければ true"
  type        = bool
  default     = true
}

variable "state_bucket" {
  description = "Terraform の状態を置く S3 バケット(backend.tf と同じ)"
  type        = string
}

variable "app_domain" {
  description = "画面と API のドメイン(例: app.example.com)"
  type        = string
}

variable "route53_zone_id" {
  description = "app_domain が入る Route 53 のゾーン"
  type        = string
}

variable "image_repository_url" {
  description = "stg の ECR(同じイメージを引く。stg の image_pull_account_ids にこのアカウントを入れる)"
  type        = string
}

variable "web_image_repository_url" {
  description = "stg の画面の ECR(stg の出力 web_ecr_repository_url)"
  type        = string
}

variable "initial_image_tag" {
  description = "最初に作るときのイメージのタグ(以後は deploy.yml が更新)"
  type        = string
  default     = "bootstrap"
}


variable "mail_image_repository_url" {
  description = "stg のメールの中継(Postfix)の ECR(stg の出力 mail_ecr_repository_url)"
  type        = string
}

variable "slack_team_id" {
  description = "Slack のワークスペースの ID(T…)。コンソールで Slack を許可したあとに分かる。null の間は Slack に流さない"
  type        = string
  default     = null
}

variable "slack_channel_id" {
  description = "知らせを流すチャンネルの ID(C…)。stg と prod でチャンネルを分ける(例: #alerts-prod)"
  type        = string
  default     = null
}

variable "alert_emails" {
  description = "メールでも受ける宛先(任意。作ったあと確認のメールのリンクを押す)"
  type        = list(string)
  default     = []
}

variable "monthly_budget_usd" {
  description = "このアカウントの月の上限(ドル)。80% を使ったときと、月末の見込みが超えるときに知らせる"
  type        = number
  default     = 600
}

variable "sentry_dsn" {
  description = "Sentry のプロジェクトの DSN(https://…)。秘密ではない(ブラウザにも渡る)。null の間は送らない"
  type        = string
  default     = null
}

variable "support_tenant_id" {
  description = "運営の組織の ID(社員がサポート番号で代理ログインする)。null の間は代理ログインを使えない。作り方は docs/runbooks/support-access.md"
  type        = string
  default     = null
}

variable "sensitive_data_enabled" {
  description = "要配慮個人情報の段1(専用の KMS の鍵・要配慮だけの接続)を作るか。要配慮の列を足す仕様が承認されたら true(ADR 0029)"
  type        = bool
  default     = false
}

variable "evidence_lock_mode" {
  description = "証跡の置き場の Object Lock。GOVERNANCE(特別な権限の人だけ消せる)か COMPLIANCE(期間の間は root でも消せない・戻せない)。設計書 0019 の U-1"
  type        = string
  default     = "GOVERNANCE"
}

variable "evidence_retention_years" {
  description = "証跡を消せない期間(年)。審査は直近の3年を見ることが多い。設計書 0019 の U-1"
  type        = number
  default     = 3
}
