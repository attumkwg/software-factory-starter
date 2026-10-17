variable "name" {
  description = "VPC などの名前の頭"
  type        = string
}

variable "cidr" {
  description = "VPC の CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "使う AZ の数"
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = "NAT を1つにして節約する(本番は false で AZ ごと)"
  type        = bool
  default     = true
}

variable "flow_log_retention_days" {
  description = "VPC フローログ(拒否した通信)を残す日数。0 なら作らない"
  type        = number
  default     = 14
}
