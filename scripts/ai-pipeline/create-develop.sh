#!/usr/bin/env bash
# Create the `develop` branch from the current `main` (idempotent).
set -euo pipefail
REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

if gh api "/repos/$REPO/branches/develop" >/dev/null 2>&1; then
  echo "develop already exists"
  exit 0
fi

MAIN_SHA=$(gh api "/repos/$REPO/branches/main" --jq .commit.sha)
gh api -X POST "/repos/$REPO/git/refs" -f ref="refs/heads/develop" -f sha="$MAIN_SHA"
echo "created develop from main ($MAIN_SHA)"
