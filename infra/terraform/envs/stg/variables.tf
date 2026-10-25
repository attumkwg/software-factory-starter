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
  description = "画面と API のドメイン(例: app.stg.example.com)"
  type        = string
}

variable "route53_zone_id" {
  description = "app_domain が入る Route 53 のゾーン"
  type        = string
}

variable "initial_image_tag" {
  description = "最初に作るときのイメージのタグ(以後は deploy.yml が更新)"
  type        = string
  default     = "bootstrap"
}

variable "image_pull_account_ids" {
  description = "このリポジトリのイメージを引いてよい AWS アカウント(prod)"
  type        = list(string)
  default     = []
}

variable "slack_team_id" {
  description = "Slack のワークスペースの ID(T…)。コンソールで Slack を許可したあとに分かる。null の間は Slack に流さない"
  type        = string
  default     = null
}

variable "slack_channel_id" {
  description = "知らせを流すチャンネルの ID(C…)。stg と prod でチャンネルを分ける(例: #alerts-stg)"
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
  default     = 250
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

variable "bet" {
  description = "既定のタグ Bet(賭けの ID)。土台は core。賭けだけのリソースは、リソースの tags で上書きする"
  type        = string
  default     = "core"
}

variable "activate_cost_allocation_tags" {
  description = "コスト配分タグ(Project・Environment・Component・Bet)を有効にする。タグが請求に出てから(最初の apply の翌日以降)true に。Organizations なら管理のアカウントで"
  type        = bool
  default     = false
}

variable "anomaly_threshold_usd" {
  description = "費用の急な変化(Cost Anomaly Detection)を知らせる、見込みの影響の下限(ドル)。null なら見張らない"
  type        = number
  default     = 10
}
