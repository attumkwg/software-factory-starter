variable "name" {
  type = string
}

variable "assumer_role_arns" {
  description = "役割 files-access を引き受けてよい役割(API のタスクと、解約の削除を流す移行のタスク)。パスの無い役割"
  type        = list(string)
}

variable "allowed_origins" {
  description = "画面の出どころ(https://app.example.com)。ブラウザから PUT・GET してよい所"
  type        = list(string)
}

variable "incoming_expire_days" {
  description = "上げ終えない物(incoming/)を消すまでの日数"
  type        = number
  default     = 1
}

variable "noncurrent_expire_days" {
  description = "消した物・上書きした物の前の版を残す日数(誤って消したときに戻せる期間。契約・規約の値。設計書 0072 の U-3)"
  type        = number
  default     = 30
}
