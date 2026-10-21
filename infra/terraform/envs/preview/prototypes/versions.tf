terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  #   terraform init -backend-config="bucket=<状態のバケット>" \
  #     -backend-config="key=preview/prototypes.tfstate" -backend-config="region=ap-northeast-1" \
  #     -backend-config="use_lockfile=true" -backend-config="encrypt=true"
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = var.project
      Environment = "prototypes"
      ManagedBy   = "terraform"
    }
  }
}
