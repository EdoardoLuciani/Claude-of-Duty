#!/usr/bin/env bash
# Compile the gh-aw markdown workflows into their committed lock files.
# Requires the gh-aw CLI extension: gh extension install github/gh-aw
set -euo pipefail
cd "$(dirname "$0")/../.."
gh aw compile agent-implement agent-fix
echo "Compiled. Commit the lock files:"
echo "  git add .github/workflows/agent-implement.lock.yml .github/workflows/agent-fix.lock.yml"
