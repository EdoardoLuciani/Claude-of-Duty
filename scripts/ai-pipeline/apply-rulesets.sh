#!/usr/bin/env bash
# Apply branch rulesets for the AI pipeline (idempotent).
#   main    : PR-only, no force pushes, no deletions
#   develop : PR-only, no force pushes, no deletions
# Agent branches (agent/*) stay unprotected on purpose.
#
# NOTE: rulesets apply to admins too (no admin bypass is configured) — both
# branches are only reachable through pull requests.
set -euo pipefail
REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

apply_ruleset() {
  local branch="$1"
  local name="AI pipeline: $branch protection"
  local existing
  existing=$(gh api "/repos/$REPO/rulesets" --jq ".[] | select(.name == \"$name\") | .id" 2>/dev/null || true)

  local payload
  payload=$(cat <<JSON
{
  "name": "$name",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["refs/heads/$branch"], "exclude": [] }
  },
  "rules": [
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": true, "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": false } },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ],
  "bypass_actors": []
}
JSON
  )

  if [ -n "$existing" ]; then
    gh api -X PUT "/repos/$REPO/rulesets/$existing" --input - <<<"$payload" >/dev/null
    echo "updated ruleset for $branch"
  else
    gh api -X POST "/repos/$REPO/rulesets" --input - <<<"$payload" >/dev/null
    echo "created ruleset for $branch"
  fi
}

apply_ruleset main
apply_ruleset develop
echo "Rulesets applied. Verify: gh api /repos/$REPO/rulesets"
echo
echo "Optional later: add required status check 'Validate / build' to the develop ruleset."
