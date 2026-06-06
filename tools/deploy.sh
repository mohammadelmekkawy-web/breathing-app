#!/usr/bin/env bash
# Deploy Breathe to GitHub Pages with a guaranteed cache bust.
#
# It stamps a UNIQUE version into sw.js (timestamp + short commit hash) so the
# service-worker file always changes → browsers detect the new worker → the old
# cache is deleted and fresh files are served. Then it commits and pushes.
#
#   ./tools/deploy.sh "optional commit message"
#
set -euo pipefail

# Run from the repo root regardless of where it's invoked from.
cd "$(dirname "$0")/.."

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "→ You have uncommitted changes; they'll be included in this deploy."
fi

# Unique, monotonic version: UTC timestamp + short SHA of the current HEAD.
STAMP="$(date -u +%Y.%m.%d-%H%M%S)"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
VERSION="${STAMP}-${SHA}"

# Rewrite the `const VERSION = '...';` line in sw.js (portable across macOS/Linux).
perl -0pi -e "s/const VERSION = '[^']*';/const VERSION = '${VERSION}';/" sw.js
echo "→ sw.js cache version = ${VERSION}"

MSG="${1:-deploy: ${VERSION}}"
git add -A
if git diff --cached --quiet; then
  echo "→ Nothing to commit."
else
  git commit -m "${MSG}"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "→ Pushing ${BRANCH} to origin…"
git push origin "${BRANCH}"

echo "✓ Pushed. GitHub Pages will rebuild in ~1 minute."
echo "  On your phone: just reopen the app — the new version loads automatically."
