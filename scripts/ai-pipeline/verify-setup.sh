#!/usr/bin/env bash
# Verify the AI pipeline setup. Prints secret NAMES only, never values.
set -euo pipefail
REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
FAIL=0

say()  { printf '%-12s %s\n' "[$1]" "$2"; }
fail() { say FAIL "$1"; FAIL=1; }
ok()   { say OK "$1"; }

gh api "/repos/$REPO/branches/develop" >/dev/null 2>&1 && ok "develop branch exists" || fail "develop branch missing (create-develop.sh)"

for label in ai-ready ai-working ai-pr-open ai-reviewing ai-fix-needed ai-approved ai-needs-human ai-failed; do
  gh label view "$label" --repo "$REPO" >/dev/null 2>&1 || fail "label missing: $label"
done
ok "labels present"

RULESETS=$(gh api "/repos/$REPO/rulesets" --jq 'length' 2>/dev/null || echo 0)
[ "$RULESETS" -ge 2 ] && ok "rulesets present ($RULESETS)" || fail "rulesets missing (apply-rulesets.sh)"

for secret in CODEX_API_KEY OPENROUTER_API_KEY AI_CI_TRIGGER_TOKEN; do
  gh secret list --repo "$REPO" | awk '{print $1}' | grep -qx "$secret" && ok "secret set: $secret" || fail "secret missing: $secret"
done

ENABLED=$(gh variable get AI_MERGE_ENABLED --repo "$REPO" 2>/dev/null || echo "")
say INFO "AI_MERGE_ENABLED=${ENABLED:-<unset>}"

if command -v gh >/dev/null && gh extension list 2>/dev/null | grep -q gh-aw; then
  cd "$(dirname "$0")/../.."
  gh aw compile agent-implement agent-fix >/dev/null 2>&1 && ok "gh-aw workflows compile" || fail "gh-aw compile failed"
else
  say INFO "gh-aw extension not installed locally — compile check skipped"
fi

[ "$FAIL" = 0 ] && echo && echo "✅ Setup verified." || { echo && echo "❌ Fix the failures above."; exit 1; }
