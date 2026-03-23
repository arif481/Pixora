#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ENV="$ROOT_DIR/apps/web/.env.local"

if [[ ! -f "$WEB_ENV" ]]; then
  echo "Missing $WEB_ENV"
  exit 1
fi

load_env_file() {
  local file="$1"
  while IFS='=' read -r key value; do
    [[ -z "${key// }" ]] && continue
    [[ "$key" =~ ^# ]] && continue
    export "$key=$value"
  done < "$file"
}

load_env_file "$WEB_ENV"

required_web=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  ALLOW_DEMO_USER
  INTERNAL_WORKER_TOKEN
  AUTO_SHARE_THRESHOLD
  REVIEW_MIN_THRESHOLD
  MIN_ENROLL_QUALITY
  PIXORA_BASE_URL
)

for key in "${required_web[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing web env var: $key"
    exit 1
  fi
done

echo "✅ Env files look complete."
echo
echo "(Secret values are intentionally not printed.)"
echo

echo "=== 1) VERCEL WEB ENV COMMANDS ==="
echo 'Run these from repository root after "vercel login" and "vercel link":'
for key in "${required_web[@]}"; do
  if [[ "$key" == "PIXORA_BASE_URL" ]]; then
    continue
  fi
  echo "printenv $key | vercel env add $key production"
done

echo
echo "=== 2) GITHUB ACTIONS SECRETS ==="
echo "Replace <owner/repo> with your repo (example: arif481/Pixora):"
for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY INTERNAL_WORKER_TOKEN; do
  echo "gh secret set $key -R <owner/repo> -b \"\${$key}\""
done
echo "gh secret set PIXORA_BASE_URL -R <owner/repo> -b \"\${PIXORA_BASE_URL}\""
echo
echo "Browser embedding mode is enabled by default."

echo
echo "⚠️ Production recommendation: set AUTO_SHARE_THRESHOLD=0.62 and REVIEW_MIN_THRESHOLD=0.48"
