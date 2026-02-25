terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "aws" {
  # Assumes AWS credentials are provided via environment variables or default profile
  region = "us-east-1"
}

resource "cloudflare_pages_project" "starchart" {
  account_id        = var.cloudflare_account_id
  name              = var.project_name
  production_branch = var.production_branch

  source {
    type = "github"
    config {
      owner                         = var.github_owner
      repo_name                     = var.github_repo
      production_branch             = var.production_branch
      pr_comments_enabled           = true
      deployments_enabled           = true
      production_deployment_enabled = true
      preview_deployment_setting    = "all"
      preview_branch_includes       = ["*"]
      preview_branch_excludes       = [var.production_branch]
    }
  }

  build_config {
    build_command   = ""
    destination_dir = "public"
    root_dir        = ""
  }
}

resource "cloudflare_pages_domain" "custom_domain" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.starchart.name
  domain       = var.custom_domain
}

resource "aws_route53_record" "custom_domain" {
  zone_id = var.aws_route53_zone_id
  name    = var.custom_domain
  type    = "CNAME"
  ttl     = 300
  records = [cloudflare_pages_project.starchart.subdomain]
}
