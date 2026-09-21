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
npx vercel pull --yes ${1:+--environment=production} >/dev/null
npx vercel build ${1:-}
npm run test:bundle
test "$(node -e "console.log(require('./.vercel/output/static/record.arc-testnet.json').refusals.length)")" -gt 0 || { echo "the built record has no refusals; not deploying" >&2; exit 1; }
npx vercel deploy --prebuilt ${1:-}
rm -f .env.local
