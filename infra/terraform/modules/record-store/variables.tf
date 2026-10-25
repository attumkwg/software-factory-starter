variable "name" {
  description = "置き場の名前の頭(後ろにアカウントの番号が付く)"
  type        = string
}

variable "lock" {
  description = "Object Lock の既定の保存(mode は GOVERNANCE か COMPLIANCE・years は年)。null なら付けない(作った後は変えられない)"
  type = object({
    mode  = string
    years = number
  })
  default = null
  validation {
    condition     = var.lock == null || contains(["GOVERNANCE", "COMPLIANCE"], try(var.lock.mode, ""))
    error_message = "lock.mode は GOVERNANCE か COMPLIANCE にしてください"
  }
}

variable "archive_after_days" {
  description = "この日数の後に、安い保存(Glacier Instant Retrieval。すぐ読める)へ移す。null なら移さない"
  type        = number
  default     = 90
}

variable "expire_days" {
  description = "今の版を、この日数の後に消す(短い間だけ置く物。申し込みの置き場など)。null なら消さない。lock とは一緒に使わない"
  type        = number
  default     = null
  validation {
    condition     = var.expire_days == null || var.lock == null
    error_message = "expire_days は lock と一緒に使えません(消せない置き場の中身を消そうとしている)"
  }
}

variable "noncurrent_expire_days" {
  description = "lock が無いときに、上書きされた古い版を消すまでの日数"
  type        = number
  default     = 400
}
