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

  # PR ごとに key を変える: -backend-config="key=preview/pr-<番号>.tfstate"
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "sfs"
      Environment = "preview"
      ManagedBy   = "terraform"
      PullRequest = tostring(var.pr_number)
    }
  }
}
