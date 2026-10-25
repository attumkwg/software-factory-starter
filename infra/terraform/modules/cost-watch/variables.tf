variable "name" {
  type = string
}

variable "project" {
  description = "既定のタグ Project の値(急な変化の見張りを、このプロダクトの費用に絞る)"
  type        = string
}

variable "topic_arn" {
  description = "知らせ先(modules/alerts の SNS。costalerts.amazonaws.com が書ける)"
  type        = string
}

variable "activate" {
  description = "コスト配分タグを有効にするか(タグが請求に出てから true に)"
  type        = bool
  default     = false
}

variable "tag_keys" {
  description = "有効にするコスト配分タグ"
  type        = list(string)
  default     = ["Project", "Environment", "Component", "Bet"]
}

variable "anomaly_threshold_usd" {
  description = "急な変化の見込みの影響が、この額(ドル)以上なら知らせる。null なら見張らない"
  type        = number
  default     = 10
}
