#!/usr/bin/env bash
# merge-pr.sh <pr-link-or-number>
set -euo pipefail

fail() { echo "refuse: $1" >&2; exit 1; }
[ $# -eq 1 ] || { echo "usage: merge-pr.sh <pr-link-or-number>" >&2; exit 2; }

cd "$(git rev-parse --show-toplevel)"
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
eval "$(gh pr view "$1" --json number,title,body,state,isDraft,baseRefName,headRefName,headRefOid,reviewDecision --jq '
  "num=\(.number | @sh)",
  "title=\(.title | @sh)",
  "body=\(.body // "" | @sh)",
  "state=\(.state | @sh)",
  "draft=\(.isDraft | @sh)",
  "base=\(.baseRefName | @sh)",
  "head_ref=\(.headRefName | @sh)",
  "head_sha=\(.headRefOid | @sh)",
  "decision=\(.reviewDecision // "" | @sh)"
')"

[ "$state" = OPEN ] || fail "pull request #$num is not open"
[ "$draft" = false ] || fail "pull request #$num is a draft"
[ "$base" = develop ] || fail "pull request #$num does not target develop"
[ "$decision" != CHANGES_REQUESTED ] || fail "pull request #$num has a changes-requested review"

mapfile -t refs < <(printf '%s' "$body" | node -e '
const s = require("fs").readFileSync(0, "utf8");
const re = /\b(?:close[ds]?|fix(?:es|ed)?|resolve[ds]?)(?:\s*:\s*|\s+)((?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+)/gi;
for (const m of s.matchAll(re)) console.log(m[1]);
')
[ "${#refs[@]}" -gt 0 ] || fail "pull request body has no closing keyword"

conclusion=$(gh api "/repos/$repo/actions/runs?head_sha=$head_sha&event=pull_request&per_page=100" \
  --jq '[.workflow_runs[] | select(.name=="Validate")][0].conclusion // ""')
[ "$conclusion" = success ] || fail "latest Validate run on $head_sha did not succeed"

if [ "$(git branch --show-current 2>/dev/null || true)" = "$head_ref" ]; then
  git cat-file -e "$head_sha^{commit}" 2>/dev/null \
    || fail "cannot compare local $head_ref with pull request head $head_sha"
  [ "$(git rev-list --count "$head_sha"..HEAD)" = 0 ] \
    || fail "this checkout of $head_ref has commits that are not on the pull request"
fi

seen=" " close_nums=""
for ref in "${refs[@]}"; do
  if [[ $ref == */* ]]; then
    ref_repo=${ref%%#*}
    [ "${ref_repo,,}" = "${repo,,}" ] || { echo "skip: $ref other repository"; continue; }
  fi
  n=${ref##*#}
  case $seen in *" $n "*) continue ;; esac
  seen+=" $n "
  if ! json=$(gh api "/repos/$repo/issues/$n" 2>&1); then
    printf '%s' "$json" | grep -q 'Not Found' && { echo "skip: #$n not found"; continue; }
    fail "could not read issue #$n"
  fi
  if jq -e '.pull_request' >/dev/null <<<"$json"; then echo "skip: #$n pull request"; continue; fi
  [ "$(jq -r .state <<<"$json")" = open ] || { echo "skip: #$n not open"; continue; }
  close_nums+="$n "
done

message="See PR #$num."
[ -z "$close_nums" ] || message="$(printf 'Fixes #%s\n' $close_nums)"$'\n'"$message"
printf '%s\n' "$message" | gh pr merge "$num" --repo "$repo" --squash \
  --match-head-commit "$head_sha" --subject="$title" --body-file - \
  || fail "merge was rejected; no issues were closed"
echo "merged: #$num"

failed=0
for n in $close_nums; do
  if gh issue close "$n" --repo "$repo" --reason completed \
    --comment "Closed after squash-merging PR #$num into develop."; then
    echo "closed: #$n"
  else
    echo "close-failed: #$n" >&2
    failed=1
  fi
done
[ "$failed" = 0 ] || { echo "merged: yes; a close failed — do not merge again" >&2; exit 1; }
