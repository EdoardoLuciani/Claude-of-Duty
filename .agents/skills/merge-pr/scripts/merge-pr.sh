#!/usr/bin/env bash
#
# Squash-merge a pull request into develop and close the open issues named by
# closing keywords in its body. See SKILL.md.
#
#   merge-pr.sh <pr-link-or-number> [--dry-run]
#
set -euo pipefail

parse_closing_refs() {
  node --input-type=module -e '
import { readFileSync } from "node:fs";
const body = readFileSync(0, "utf8");
const re = /\b(close[ds]?|fix(?:es|ed)?|resolve[ds]?)(?:\s*:\s*|\s+)((?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+)/gi;
const seen = new Set();
const out = [];
for (const match of body.matchAll(re)) {
  const ref = match[2];
  const key = ref.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  out.push(ref);
}
if (out.length) process.stdout.write(out.join("\n") + "\n");
'
}

usage() {
  echo "usage: merge-pr.sh <pr-link-or-number> [--dry-run]" >&2
  exit 2
}

fail() {
  echo "refuse: $1" >&2
  exit 1
}

main() {
  local pr="" dry=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1; shift ;;
      -*) echo "unknown flag: $1" >&2; exit 2 ;;
      *)
        [ -z "$pr" ] || usage
        pr="$1"
        shift
        ;;
    esac
  done
  [ -n "$pr" ] || usage
  command -v gh >/dev/null || { echo "need gh on PATH" >&2; exit 3; }
  command -v jq >/dev/null || { echo "need jq on PATH" >&2; exit 3; }
  command -v node >/dev/null || { echo "need node on PATH" >&2; exit 3; }

  if git rev-parse --show-toplevel >/dev/null 2>&1; then
    cd "$(git rev-parse --show-toplevel)"
  fi

  local repo_json pr_json
  repo_json=$(gh repo view --json nameWithOwner) || fail "could not resolve this repository"
  local repo
  repo=$(jq -r '.nameWithOwner // empty' <<<"$repo_json")
  [ -n "$repo" ] || fail "could not resolve this repository"

  pr_json=$(gh pr view "$pr" --json number,url,title,body,state,isDraft,baseRefName,headRefName,headRefOid,reviewDecision) \
    || fail "could not resolve pull request: $pr"

  local num url title body state draft base head_ref head_sha decision
  num=$(jq -r '.number // empty' <<<"$pr_json")
  url=$(jq -r '.url // empty' <<<"$pr_json")
  title=$(jq -r '.title // empty' <<<"$pr_json")
  body=$(jq -r '.body // ""' <<<"$pr_json")
  state=$(jq -r '.state // empty' <<<"$pr_json")
  draft=$(jq -r '.isDraft' <<<"$pr_json")
  base=$(jq -r '.baseRefName // empty' <<<"$pr_json")
  head_ref=$(jq -r '.headRefName // empty' <<<"$pr_json")
  head_sha=$(jq -r '.headRefOid // empty' <<<"$pr_json")
  decision=$(jq -r '.reviewDecision // ""' <<<"$pr_json")
  [ -n "$num" ] && [ -n "$head_sha" ] || fail "could not read pull request #$pr"

  [ "$state" = "OPEN" ] || fail "pull request #$num is not open"
  [ "$draft" = "false" ] || fail "pull request #$num is a draft"
  [ "$base" = "develop" ] || fail "pull request #$num does not target develop"
  [ "$decision" != "CHANGES_REQUESTED" ] || fail "pull request #$num has a changes-requested review"

  local -a refs=()
  local ref
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    refs+=("$ref")
  done < <(printf '%s' "$body" | parse_closing_refs)
  [ "${#refs[@]}" -gt 0 ] || fail "pull request body has no closing keyword"

  local runs conclusion
  runs=$(gh api "/repos/$repo/actions/runs?head_sha=$head_sha&event=pull_request&per_page=100") \
    || fail "could not read Validate runs for $head_sha"
  conclusion=$(jq -r '[.workflow_runs[]? | select(.name=="Validate")][0].conclusion // ""' <<<"$runs") \
    || fail "could not read Validate runs for $head_sha"
  [ "$conclusion" = "success" ] || fail "latest Validate run on $head_sha did not succeed"

  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local local_branch ahead
    local_branch=$(git branch --show-current || true)
    if [ -n "$local_branch" ] && [ "$local_branch" = "$head_ref" ]; then
      git cat-file -e "${head_sha}^{commit}" 2>/dev/null \
        || fail "cannot compare local $head_ref with pull request head $head_sha"
      ahead=$(git rev-list --count "$head_sha"..HEAD)
      [ "$ahead" = "0" ] || fail "this checkout of $head_ref has commits that are not on the pull request"
    fi
  fi

  local repo_lc seen=" "
  repo_lc=$(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]')
  local -a close_nums=()
  local skips=""
  for ref in "${refs[@]}"; do
    local ref_repo="" ref_num ref_repo_lc issue_json is_pr issue_state
    if [[ "$ref" == */* ]]; then
      ref_repo="${ref%%#*}"
      ref_num="${ref##*#}"
      ref_repo_lc=$(printf '%s' "$ref_repo" | tr '[:upper:]' '[:lower:]')
      if [ "$ref_repo_lc" != "$repo_lc" ]; then
        skips+="skip: $ref other repository"$'\n'
        continue
      fi
    else
      ref_num="${ref#\#}"
    fi
    ref_num=$(printf '%s' "$ref_num" | sed 's/^0*//' )
    [ -n "$ref_num" ] || ref_num=0
    case "$seen" in
      *" #$ref_num "*) continue ;;
    esac
    seen+=" #$ref_num "

    if ! issue_json=$(gh api "/repos/$repo/issues/$ref_num" 2>&1); then
      if printf '%s' "$issue_json" | grep -q 'Not Found'; then
        skips+="skip: #$ref_num not found"$'\n'
        continue
      fi
      fail "could not read issue #$ref_num"
    fi
    is_pr=$(jq -r 'if .pull_request then "yes" else "no" end' <<<"$issue_json")
    if [ "$is_pr" = "yes" ]; then
      skips+="skip: #$ref_num pull request"$'\n'
      continue
    fi
    issue_state=$(jq -r '.state // ""' <<<"$issue_json")
    if [ "$issue_state" != "open" ]; then
      skips+="skip: #$ref_num not open"$'\n'
      continue
    fi
    close_nums+=("$ref_num")
  done

  echo "pr: #$num  $url"
  echo "gates: ok"
  if [ "${#close_nums[@]}" -eq 0 ]; then
    echo "close: none"
  else
    for ref_num in "${close_nums[@]}"; do
      echo "close: #$ref_num"
    done
  fi
  if [ -n "$skips" ]; then
    printf '%s' "$skips"
  fi
  echo "squash-title: $title"

  local message="" n
  for n in "${close_nums[@]+"${close_nums[@]}"}"; do
    [ -n "${n:-}" ] || continue
    message+="Fixes #$n"$'\n'
  done
  message+="See PR #$num."
  echo "squash-body:"
  printf '%s\n' "$message"

  if [ "$dry" = 1 ]; then
    echo "dry-run: no writes"
    exit 0
  fi

  local body_file
  body_file=$(mktemp)
  trap "rm -f $(printf '%q' "$body_file")" EXIT
  printf '%s\n' "$message" >"$body_file"
  gh pr merge "$num" --repo "$repo" --squash \
    --match-head-commit "$head_sha" \
    --subject="$title" \
    --body-file "$body_file" \
    || fail "merge was rejected; no issues were closed"

  echo "merged: yes"
  local close_failed=0
  for n in "${close_nums[@]+"${close_nums[@]}"}"; do
    [ -n "${n:-}" ] || continue
    if gh issue close "$n" --repo "$repo" --reason completed \
      --comment "Closed after squash-merging PR #$num into develop."; then
      echo "closed: #$n"
    else
      echo "close-failed: #$n" >&2
      close_failed=1
    fi
  done
  if [ "$close_failed" = 1 ]; then
    echo "merged: yes; a close failed — do not merge again" >&2
    exit 1
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
