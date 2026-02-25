output "pages_subdomain" {
  description = "The subdomain of the Cloudflare Pages project."
  value       = cloudflare_pages_project.starchart.subdomain
}

output "pages_url" {
  description = "The URL of the Cloudflare Pages project."
  value       = "https://${cloudflare_pages_project.starchart.subdomain}"
}
