#!/bin/sh
# Builds the page HERE, where deployments/<network>.json exists, and uploads exactly that output.
# A build on Vercel's side would see only this folder, and ship a page with no refused attempts on it.
#
#   packages/status/scripts/deploy.sh            a preview
#   packages/status/scripts/deploy.sh --prod     production
#
# Needs `npx vercel login` and a linked project (.vercel/, git-ignored). Read-only page: there is no secret to deploy.
set -eu
cd "$(dirname "$0")/.."

# `vercel pull` and `vercel link` write env files that carry a VERCEL_OIDC_TOKEN: .env.local here, and
# .vercel/.env.<environment>.local. Nothing in this build needs them. They are removed when the script exits, however
# it exits, so that a failed deploy does not leave a token on disk.
cleanup() {
  rm -f .env.local .env.*.local .vercel/.env.*.local
}
trap cleanup EXIT INT TERM

npx vercel pull --yes ${1:+--environment=production} >/dev/null
npx vercel build ${1:-}
npm run test:bundle
test "$(node -e "console.log(require('./.vercel/output/static/record.arc-testnet.json').refusals.length)")" -gt 0 || { echo "the built record has no refusals; not deploying" >&2; exit 1; }
npx vercel deploy --prebuilt ${1:-}
