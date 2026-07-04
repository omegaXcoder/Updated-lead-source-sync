# Pushes exactly the env vars the multi-client GitHub Action needs from your
# local .env into this repo's GitHub Actions secrets, via the GitHub CLI.
#
# Prerequisites:
#   1. Install GitHub CLI: https://cli.github.com/
#   2. Authenticate once:  gh auth login
#   3. Run this from the repo root:  .\scripts\push-secrets-to-github.ps1
#
# Safe to re-run - gh secret set overwrites existing secrets with the same name.
# Nothing here prints secret values to the terminal.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path ".env")) {
    Write-Error "No .env file found in $(Get-Location) - nothing to push."
    exit 1
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) not found on PATH. Install it from https://cli.github.com/ then run: gh auth login"
    exit 1
}

# Parse .env into a hashtable (KEY=VALUE lines only, ignoring comments/blanks).
$envValues = @{}
Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $idx = $_.IndexOf('=')
    $key = $_.Substring(0, $idx).Trim()
    $value = $_.Substring($idx + 1).Trim()
    $envValues[$key] = $value
}

# Exactly the keys referenced in .github/workflows/multi-client-sync.yml -
# keep this list in sync with that file if either one changes.
$keys = @(
    "WHATCONVERTS_API_TOKEN",
    "WHATCONVERTS_API_SECRET",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "SMTP_TO",
    "SA_EMAIL_BLUE_SKY_LANDSCAPING",
    "SA_PASSWORD_BLUE_SKY_LANDSCAPING",
    "SA_EMAIL_BROTHERS",
    "SA_PASSWORD_BROTHERS",
    "SA_EMAIL_ESSENTIAL_LANDSCAPES",
    "SA_PASSWORD_ESSENTIAL_LANDSCAPES",
    "SA_EMAIL_HEARTLAND_TURF_LANDSCAPE",
    "SA_PASSWORD_HEARTLAND_TURF_LANDSCAPE",
    "SA_EMAIL_HOLMES_LAWN_PEST",
    "SA_PASSWORD_HOLMES_LAWN_PEST",
    "SA_EMAIL_LITTLE_JOHNS_LAWNS",
    "SA_PASSWORD_LITTLE_JOHNS_LAWNS",
    "SA_EMAIL_MERRILL_SERVICES",
    "SA_PASSWORD_MERRILL_SERVICES",
    "SA_EMAIL_PRO_OUTDOOR_LLC",
    "SA_PASSWORD_PRO_OUTDOOR_LLC",
    "SA_EMAIL_SIMPLE_LAWNS_LANDSCAPING",
    "SA_PASSWORD_SIMPLE_LAWNS_LANDSCAPING",
    "SA_EMAIL_SUMMIT_LAWNS",
    "SA_PASSWORD_SUMMIT_LAWNS"
)

foreach ($key in $keys) {
    $value = $envValues[$key]
    if ([string]::IsNullOrEmpty($value)) {
        Write-Host "SKIP  $key (blank or missing in .env)"
        continue
    }
    $value | gh secret set $key | Out-Null
    Write-Host "SET   $key"
}

Write-Host "Done. Review at: gh secret list"
