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

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = var.project
      Environment = local.env
      ManagedBy   = "terraform"
      Repository  = var.github_repository
    }
  }
}
