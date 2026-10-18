# PR ごとのプレビュー環境。preview.yml が PR ごとに別の状態のキーで apply / destroy する:
#   terraform init -backend-config="key=preview/pr-<番号>.tfstate" ...
#   terraform apply -var pr_number=<番号> -var image=<API のイメージ> -var web_image=<画面のイメージ> -var domain=<domain>
# 共有の土台(envs/preview/base)は名前で引く(状態どうしをつながない)。

data "aws_ecs_cluster" "preview" {
  cluster_name = "preview"
}

data "aws_lb" "preview" {
  name = "preview"
}

data "aws_lb_listener" "https" {
  load_balancer_arn = data.aws_lb.preview.arn
  port              = 443
}

data "aws_vpc" "preview" {
  tags = { Name = "preview" }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.preview.id]
  }
  tags = { Tier = "private" }
}

data "aws_security_group" "service" {
  name   = "preview-service"
  vpc_id = data.aws_vpc.preview.id
}

data "aws_iam_role" "execution" {
  name = "preview-execution"
}

data "aws_iam_role" "task" {
  name = "preview-task"
}

data "aws_kms_alias" "preview" {
  name = "alias/preview"
}

module "preview" {
  source                    = "../../../modules/preview-env"
  pr_number                 = var.pr_number
  domain                    = var.domain
  image                     = var.image
  web_image                 = var.web_image
  cluster_arn               = data.aws_ecs_cluster.preview.arn
  listener_arn              = data.aws_lb_listener.https.arn
  vpc_id                    = data.aws_vpc.preview.id
  private_subnet_ids        = data.aws_subnets.private.ids
  service_security_group_id = data.aws_security_group.service.id
  execution_role_arn        = data.aws_iam_role.execution.arn
  task_role_arn             = data.aws_iam_role.task.arn
  log_group_name            = "/ecs/preview"
  secrets_kms_key_arn       = data.aws_kms_alias.preview.target_key_arn
}

output "url" {
  value = module.preview.url
}
