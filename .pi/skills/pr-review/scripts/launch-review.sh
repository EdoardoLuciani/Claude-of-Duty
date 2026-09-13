#!/usr/bin/env bash
#
# Launch an independent reviewer pi session for a pull request.
#
#   launch-review.sh <pr-link-or-number> [--dry-run] [--no-post]
#
# Picks the reviewer model from the *caller's* model ($PI_MODEL), writes the
# reviewer prompt, and starts `pi -p` detached so the caller can poll instead of
# blocking a tool call for the length of a review.
#
# On success it prints the model it chose and the paths the caller needs. The
# reviewer posts its own comment on the PR; this script does not post anything.
#
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage: launch-review.sh <pr-link-or-number> [--dry-run] [--no-post]

  --dry-run   resolve the model and PR, print what would run, launch nothing
  --no-post   tell the reviewer to write findings to the stdout path instead of
              posting a PR comment (for validating on a PR you do not own)
  -h, --help  this text
USAGE
}

PR=""
DRY_RUN=0
DO_POST=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --no-post) DO_POST=0 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; usage >&2; exit 2 ;;
    *) PR="$1" ;;
  esac
  shift
done
[ -n "$PR" ] || { usage >&2; exit 2; }

command -v gh >/dev/null || { echo "gh is not on PATH" >&2; exit 3; }
command -v pi >/dev/null || { echo "pi is not on PATH" >&2; exit 3; }

# --- reviewer model, chosen from the caller's model --------------------------
# Contract lives in SKILL.md; keep the two in step.
CALLER_MODEL="${PI_MODEL:-}"
THINKING="high"
case "$CALLER_MODEL" in
  *deepseek*) REVIEW_MODEL="xai/grok-4.6" ;;
  *grok*)     REVIEW_MODEL="openai-codex/gpt-5.6-sol" ;;
  *astra*)    REVIEW_MODEL="openai-codex/gpt-6-astra" ;;
  *)          REVIEW_MODEL="xai/grok-4.6" ;;
esac

# --- preflight: credentials for the chosen model -----------------------------
# Fail here rather than 404 a minute into the run.
AUTH_ERR=""
if ! pi auth check --model "$REVIEW_MODEL" >/dev/null 2>&1; then
  AUTH_ERR="$(pi auth check --model "$REVIEW_MODEL" 2>&1 | tail -2 || true)"
  echo "warning: $REVIEW_MODEL is not ready: $AUTH_ERR" >&2
  if [ "$REVIEW_MODEL" != "xai/grok-4.6" ] && pi auth check --model "xai/grok-4.6" >/dev/null 2>&1; then
    REVIEW_MODEL="xai/grok-4.6"
    echo "warning: falling back to $REVIEW_MODEL" >&2
  else
    echo "error: no usable reviewer model; check 'pi auth check --model $REVIEW_MODEL'" >&2
    exit 3
  fi
fi

# --- resolve the PR ----------------------------------------------------------
NUM="$(gh pr view "$PR" --json number -q .number)"
URL="$(gh pr view "$NUM" --json url -q .url)"
BASE="$(gh pr view "$NUM" --json baseRefName -q .baseRefName)"
HEAD="$(gh pr view "$NUM" --json headRefName -q .headRefName)"
SHA="$(gh pr view "$NUM" --json headRefOid -q .headRefOid | cut -c1-8)"

OUT="/tmp/pr-${NUM}-review.md"
ERR="/tmp/pr-${NUM}-review.err"
EXIT="/tmp/pr-${NUM}-review.exit"
PROMPT_FILE="/tmp/pr-${NUM}-review-prompt.md"
SID="pr-review-${NUM}-$(date +%Y%m%dT%H%M%S)"

# --- reviewer prompt ---------------------------------------------------------
# Placeholders are substituted below so the heredoc needs no escaping.
cat >"$PROMPT_FILE" <<'PROMPT'
__TASK__

#__NUM__  base __BASE__  head __HEAD__ (__SHA__)

You are the independent reviewer. The agent that wrote this code is not you: read the diff and the
code around it yourself, and take nothing in the PR description on trust.

Read before judging:
- `AGENTS.md` and `ARCHITECTURE.md` carry the invariants you are checking against. Read them first.
- `gh pr diff __NUM__` for the change, then the files it touches in the working tree — hunks hide the
  context that decides whether the hunk is right.
- Follow the change into its callers and its data. If the diff claims a behaviour, find the thing that
  produces it.

Evidence, not impressions:
- Verify before asserting: run the tests, run the build, inspect the data the code reads, compute the
  numbers. Label anything you could not check as a guess.
- Where you criticise a value, colour, distance or threshold, give the number you measured and the
  number you expected. "This looks too dark" is not a finding; "20 luma against a 40 floor" is.
- Say what works, and say plainly what you examined and concluded is NOT a problem, so it does not get
  re-litigated.

The only thing you may write is the review:
- Do not edit files, do not commit, do not push, do not open anything, do not fix anything you find.
- __POST_RULE__
- Lead with a verdict. Then the findings in severity order, each with the evidence behind it. Mark
  taste calls as taste calls, and name the one change that would make you approve.
PROMPT

if [ "$DO_POST" = "1" ]; then
  TASK="Review this PR $URL, then post your findings as a review comment on the PR."
  POST_RULE="Post exactly one comment: write the body to a file first, then \`gh pr comment $NUM --body-file <file>\`."
else
  TASK="Review this PR $URL. Do not post anything to GitHub: your final message is the review."
  POST_RULE="Do not write any file and do not post anything. End your turn with the complete review as your final message, because that message is all the caller receives."
fi

# the rules carry backticks and real paths, so insert them before the placeholder
# pass and keep them out of it
python3 - "$PROMPT_FILE" "$POST_RULE" "$TASK" <<'PY'
import sys
path, rule, task = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read().replace('__POST_RULE__', rule).replace('__TASK__', task)
open(path, 'w').write(s)
PY

sed -i \
  -e "s|__URL__|$URL|g" \
  -e "s|__NUM__|$NUM|g" \
  -e "s|__BASE__|$BASE|g" \
  -e "s|__HEAD__|$HEAD|g" \
  -e "s|__SHA__|$SHA|g" \
  -e "s|__OUT__|$OUT|g" \
  "$PROMPT_FILE"

# --- report ------------------------------------------------------------------
echo "model:   $REVIEW_MODEL (thinking $THINKING)   [caller: ${CALLER_MODEL:-unset}]"
echo "pr:      #$NUM  $URL  base $BASE  head $HEAD ($SHA)"
echo "session: $SID"
echo "prompt:  $PROMPT_FILE"
echo "stdout:  $OUT      <- the reviewer's final message"
echo "stderr:  $ERR      <- progress and errors"
echo "exit:    $EXIT     <- written when the run ends"

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "dry run; would have run:"
  echo "  pi -p --model $REVIEW_MODEL --thinking $THINKING --approve \\"
  echo "     --session-id $SID --name 'PR #$NUM review' \"\$(cat $PROMPT_FILE)\""
  exit 0
fi

# --- launch detached ---------------------------------------------------------
# -p keeps it non-interactive; --approve is the project-trust flag the run needs
# to load this repo's skills and AGENTS.md without a prompt (non-interactive
# modes never show one). It does not widen tool permissions.
#
# setsid detaches into its own session so the run cannot be taken out by a
# signal aimed at the caller's process group. The exit code is written to a file
# because the wrapper shell is gone by the time anyone can wait() for it: a run
# that dies mid-turn leaves stdout empty and nothing on stderr, and the exit code
# is then the only thing that distinguishes "crashed" from "still thinking".
cd "$(git rev-parse --show-toplevel)"
: >"$OUT"
: >"$EXIT"
setsid nohup bash -c '
  pi -p \
    --model "$1" \
    --thinking "$2" \
    --approve \
    --session-id "$3" \
    --name "PR #$4 review" \
    "$(cat "$5")" \
    >"$6" 2>"$7"
  echo "exit=$?" >"$8"
' _ "$REVIEW_MODEL" "$THINKING" "$SID" "$NUM" "$PROMPT_FILE" "$OUT" "$ERR" "$EXIT" \
  </dev/null >/dev/null 2>&1 &
echo "pid:     $!"
echo
echo "poll:    sleep 60; tail -5 $ERR; ls -l $OUT; cat $EXIT 2>/dev/null"
echo "collect: gh pr view $NUM --json comments,reviews"
echo "check:   git branch --show-current; git worktree list; git status --short"
