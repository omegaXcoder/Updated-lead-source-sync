#!/usr/bin/env bash
# Pushes exactly the env vars the multi-client GitHub Action needs from your
# local .env into this repo's GitHub Actions secrets, via the GitHub CLI.
#
# Prerequisites:
#   1. Install GitHub CLI: https://cli.github.com/
#   2. Authenticate once:  gh auth login
#   3. Run this from the repo root:  bash scripts/push-secrets-to-github.sh
#
# Safe to re-run — gh secret set overwrites existing secrets with the same name.
# Nothing here prints secret values to the terminal.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env file found in $(pwd) — nothing to push." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) not found. Install it from https://cli.github.com/ then run: gh auth login" >&2
  exit 1
fi

# Exactly the keys referenced in .github/workflows/multi-client-sync.yml —
# keep this list in sync with that file if either one changes.
KEYS=(
  WHATCONVERTS_API_TOKEN
  WHATCONVERTS_API_SECRET
  SMTP_HOST
  SMTP_PORT
  SMTP_USER
  SMTP_PASS
  SMTP_FROM
  SMTP_TO
  SA_EMAIL_BLUE_SKY_LANDSCAPING
  SA_PASSWORD_BLUE_SKY_LANDSCAPING
  SA_EMAIL_BROTHERS
  SA_PASSWORD_BROTHERS
  SA_EMAIL_ESSENTIAL_LANDSCAPES
  SA_PASSWORD_ESSENTIAL_LANDSCAPES
  SA_EMAIL_HEARTLAND_TURF_LANDSCAPE
  SA_PASSWORD_HEARTLAND_TURF_LANDSCAPE
  SA_EMAIL_HOLMES_LAWN_PEST
  SA_PASSWORD_HOLMES_LAWN_PEST
  SA_EMAIL_LITTLE_JOHNS_LAWNS
  SA_PASSWORD_LITTLE_JOHNS_LAWNS
  SA_EMAIL_MERRILL_SERVICES
  SA_PASSWORD_MERRILL_SERVICES
  SA_EMAIL_PRO_OUTDOOR_LLC
  SA_PASSWORD_PRO_OUTDOOR_LLC
  SA_EMAIL_SIMPLE_LAWNS_LANDSCAPING
  SA_PASSWORD_SIMPLE_LAWNS_LANDSCAPING
  SA_EMAIL_SUMMIT_LAWNS
  SA_PASSWORD_SUMMIT_LAWNS
)

for KEY in "${KEYS[@]}"; do
  VALUE=$(node -e "
    require('dotenv').config();
    const v = process.env['$KEY'];
    if (v) process.stdout.write(v);
  ")
  if [ -z "$VALUE" ]; then
    echo "SKIP  $KEY (blank or missing in .env)"
    continue
  fi
  gh secret set "$KEY" --body "$VALUE" >/dev/null
  echo "SET   $KEY"
done

echo "Done. Review at: gh secret list"
