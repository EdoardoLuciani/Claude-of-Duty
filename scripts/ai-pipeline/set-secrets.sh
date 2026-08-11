#!/usr/bin/env bash
# Configure the pipeline secrets WITHOUT exposing their values.
# Prompts for each value with a hidden read; values are only ever passed to
# `gh secret set` and never echoed, logged, or committed.
set -euo pipefail
REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

prompt_secret() {
  local name="$1" hint="$2"
  local value
  read -r -s -p "Value for $name ($hint): " value
  echo
  if [ -z "$value" ]; then
    echo "skipped $name (empty input)"
    return
  fi
  printf '%s' "$value" | gh secret set "$name" --repo "$REPO"
  echo "set $name"
}

echo "==> CODEX_API_KEY — your OpenCode Go API key (https://opencode.ai/auth)"
echo "    (named CODEX_API_KEY because the pinned gh-aw pi engine's codex"
echo "     backend requires that env var name; the value is the OpenCode Go key)"
prompt_secret CODEX_API_KEY "OpenCode Go API key (sk-...)"

echo
echo "==> OPENROUTER_API_KEY — OpenRouter API key for the reviewer (https://openrouter.ai/keys)"
prompt_secret OPENROUTER_API_KEY "OpenRouter API key (sk-or-...)"

echo
echo "==> AI_CI_TRIGGER_TOKEN — fine-grained PAT (Contents: Read & Write, this repo only)"
echo "    Needed so PRs created by the pipeline trigger CI."
prompt_secret AI_CI_TRIGGER_TOKEN "fine-grained PAT (github_pat_...)"

echo
echo "Done. Verify (names only):"
gh secret list --repo "$REPO"
