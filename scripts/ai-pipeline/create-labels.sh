#!/usr/bin/env bash
# Create the AI pipeline labels (idempotent).
set -euo pipefail
REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

create_label() {
  local name="$1" color="$2" desc="$3"
  if gh label view "$name" --repo "$REPO" >/dev/null 2>&1; then
    echo "label exists: $name"
  else
    gh label create "$name" --repo "$REPO" --color "$color" --description "$desc"
    echo "created label: $name"
  fi
}

create_label ai-ready       "0E8A16" "Owner authorization: an agent may attempt this issue"
create_label ai-working     "C5DEF5" "Implementation agent is working on this"
create_label ai-pr-open     "1D76DB" "Autonomous PR is open, targeting develop"
create_label ai-reviewing   "FBCA04" "Independent review in progress"
create_label ai-fix-needed  "D93F0B" "Fix round requested (review findings or CI failure)"
create_label ai-approved    "0E8A16" "Latest review approved; merge gate decides"
create_label ai-needs-human "B60205" "Terminal state: a human must take over"
create_label ai-failed      "B60205" "Pipeline failure"

echo "Labels ready on $REPO"
