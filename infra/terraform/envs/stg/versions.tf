terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # 状態は S3(バケットのバージョニングと暗号化を有効に。ロックは S3 のロックファイル)。
  # 値はここに書かず、init のときに渡す(アカウントごとに違うため):
  #   terraform init \
  #     -backend-config="bucket=<状態のバケット>" \
  #     -backend-config="key=stg/terraform.tfstate" \
  #     -backend-config="region=ap-northeast-1" \
  #     -backend-config="use_lockfile=true" \
  #     -backend-config="encrypt=true"
  backend "s3" {}
}

# 全部のリソースに付けるタグ(費用を「何に・どの環境・どの賭け」で分ける。docs/guides/cost-dashboard.md・ADR 0032)。
#   Component は動いている物ごと。モジュールに、既定のタグの違う provider(下の別名)を渡して付ける(モジュールの中は変えない)。
#   Bet は賭けの ID(docs/product/bets)。土台は core。賭けだけのリソースは、リソースの tags で Bet = "B-NNNN" に上書きする
locals {
  default_tags = {
    Project     = var.project
    Environment = local.env
    ManagedBy   = "terraform"
    Repository  = var.github_repository
    Bet         = var.bet
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = merge(local.default_tags, { Component = "shared" })
  }
}

# 外形監視(Route 53 のヘルスチェック)の数字はバージニアにしか出ないので、アラームと通知はここに置く
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = merge(local.default_tags, { Component = "shared" })
  }
}

# Component = api(API と入口(ALB・ECS のクラスター))
provider "aws" {
  alias  = "api"
  region = var.region
  default_tags {
    tags = merge(local.default_tags, { Component = "api" })
  }
}

# Component = web(画面の SSR)
provider "aws" {
  alias  = "web"
  region = var.region
  default_tags {
    tags = merge(local.default_tags, { Component = "web" })
  }
}

# Component = mail(メールの中継と SES)
provider "aws" {
  alias  = "mail"
  region = var.region
  default_tags {
    tags = merge(local.default_tags, { Component = "mail" })
  }
}

# Component = db(DB(Aurora)とバックアップ)
provider "aws" {
  alias  = "db"
  region = var.region
  default_tags {
    tags = merge(local.default_tags, { Component = "db" })
  }
}

# Component = network(VPC・NAT・フローログ)
provider "aws" {
  alias  = "network"
  region = var.region
  default_tags {
    tags = merge(local.default_tags, { Component = "network" })
  }
}
