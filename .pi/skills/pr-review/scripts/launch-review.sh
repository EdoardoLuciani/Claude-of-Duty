#!/usr/bin/env bash
#
# Launch an independent reviewer pi session for a pull request.
#
#   launch-review.sh <pr-link-or-number> [--dry-run]
#
# Starts `pi -p` detached so the caller can poll instead of blocking a tool call
# for the length of a review. The reviewer posts its own comment. See SKILL.md.
#
set -euo pipefail

PR=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) PR="$arg" ;;
  esac
done
[ -n "$PR" ] || { echo "usage: launch-review.sh <pr-link-or-number> [--dry-run]" >&2; exit 2; }
command -v gh >/dev/null && command -v pi >/dev/null || { echo "need gh and pi on PATH" >&2; exit 3; }

# Always gpt-6-astra. Catches a missing login, not a wrong model id: auth is per
# provider, so a bogus id gets through here and fails at runtime with exit 1.
REVIEW_MODEL=openai-codex/gpt-6-astra
pi auth check --model "$REVIEW_MODEL" >/dev/null 2>&1 ||
  { echo "$REVIEW_MODEL is not authenticated: pi auth check --model $REVIEW_MODEL" >&2; exit 3; }

IFS=$'\t' read -r NUM URL < <(gh pr view "$PR" --json number,url -q '[.number,.url]|@tsv')
[ -n "$NUM" ] || { echo "could not resolve PR: $PR" >&2; exit 3; }

PROMPT=/tmp/pr-$NUM-prompt.md
OUT=/tmp/pr-$NUM-review.md
ERR=/tmp/pr-$NUM-review.err
EXIT=/tmp/pr-$NUM-review.exit
SID=pr-review-$NUM-$(date +%Y%m%dT%H%M%S)

# A normal agent — same AGENTS.md, skills and tools — so it reviews like a
# reviewer and reads the repo's invariants without being told. Keep this short:
# only say what a competent reviewer would not already do.
cat >"$PROMPT" <<PROMPT
Review this PR: $URL

Look for bugs, code-quality smells, and potential simplifications. Post your
findings as one comment on the PR: gh pr comment $NUM --body-file <file>.

Verify before asserting: run the tests and the build, inspect the data, compute the
numbers, and give the number you measured against the number you expected. Say what
you checked and concluded is not a problem, mark what you could not check as a guess,
and lead with a verdict. Do not edit, commit or push.
PROMPT

echo "model:   $REVIEW_MODEL (thinking high)"
echo "pr:      #$NUM  $URL"
echo "session: $SID"
echo "stdout:  $OUT    stderr: $ERR    exit: $EXIT"

[ "$DRY_RUN" = 1 ] && { echo; echo "dry run; prompt written to $PROMPT"; exit 0; }

# setsid so the run cannot be taken out by a signal aimed at this process group,
# and the exit code written to a file because the wrapper is gone by the time
# anyone can wait(): a run that dies mid-turn leaves stdout empty and stderr
# silent, so that file is the only thing separating "crashed" from "still
# thinking". --approve is the project-trust flag needed to load this repo's
# skills and AGENTS.md without a prompt; non-interactive modes never show one.
: >"$OUT"
: >"$EXIT"
cd "$(git rev-parse --show-toplevel)"
setsid nohup bash -c '
  pi -p --model "$1" --thinking high --approve --session-id "$2" \
    --name "PR #$3 review" "$(cat "$4")" >"$5" 2>"$6"
  echo "exit=$?" >"$7"
' _ "$REVIEW_MODEL" "$SID" "$NUM" "$PROMPT" "$OUT" "$ERR" "$EXIT" \
  </dev/null >/dev/null 2>&1 &
echo "pid:     $!"
echo
echo "poll:    sleep 60; tail -5 $ERR; ls -l $OUT; cat $EXIT 2>/dev/null"
echo "collect: gh pr view $NUM --json comments,reviews"
echo "check:   git branch --show-current; git worktree list; git status --short"
