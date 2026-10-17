output "url" {
  value = "https://${local.host}"
}

output "service_name" {
  value = aws_ecs_service.this.name
}
