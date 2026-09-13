---
name: pr-review
description: Spawns a second pi agent to review a pull request independently — its own model, its own context — then reads the findings back so they can be verified, disputed and acted on. Use when the user asks for an independent or second-agent review of a PR.
disable-model-invocation: true
---

# PR review by a second agent

> **User-only.** `disable-model-invocation` hides this skill from the model. Run
> `/skill:pr-review <pr-link-or-number>`.

A second pi session reviews the PR — its own model, its own context, no memory of writing the code —
and posts its findings there. You then verify them: a review is an input, not an instruction.

It runs as a normal agent (same `AGENTS.md`, same skills and tools), so it can test a claim against
the repo's own invariants. It is read-only apart from the one comment it posts.

## Reviewer model, from your own

The mapping below is the contract; always `--thinking high`.

```bash
N=$(gh pr view "$PR" --json number -q .number)
case "${PI_MODEL:-}" in            # a reviewer that shares your blind spots is not a review
  *deepseek*) M=xai/grok-4.6 ;;
  *grok*)     M=openai-codex/gpt-5.6-sol ;;
  *astra*)    M=openai-codex/gpt-6-astra ;;
  *)          M=xai/grok-4.6 ;;
esac
pi auth check --model "$M"    # fail here, not a minute into the run
```

## Prompt

`write` this to `/tmp/pr-$N-prompt.md`, substituting `<url>`, `<n>`, base and head:

    Review this PR <url>, then post your findings as a review comment on the PR.
    You are the independent reviewer: read the diff and the code around it yourself, and take nothing
    in the PR description on trust. Read AGENTS.md — the invariants you are checking against — and
    follow the change into its callers and its data.
    Verify before asserting: run the tests and the build, inspect the data, compute the numbers, and
    give the number you measured against the number you expected. Mark anything you could not check
    as a guess. Say what works, and what you examined and concluded is NOT a problem.
    Do not edit, commit or push. The only thing you write is one comment, body in a file, posted with
    `gh pr comment <n> --body-file <file>`: verdict first, then findings in severity order with their
    evidence, and taste calls marked as taste calls.

## Launch detached

`setsid` and the exit file earn their keep: a run can die mid-turn and leave an empty stdout with a
silent stderr, and then the exit code is the only signal you have that it failed. `--approve` is the
project-trust flag that lets it load this repo's skills and `AGENTS.md` without a prompt — drop it and
the reviewer silently loses the invariants it is checking against.

```bash
S=pr-review-$N-$(date +%s)
setsid nohup bash -c 'pi -p --model "$1" --thinking high --approve --session-id "$2" \
  --name "PR #$3 review" "$(cat "$4")" >"$5" 2>"$6"; echo "exit=$?" >"$7"' \
  _ "$M" "$S" "$N" /tmp/pr-$N-prompt.md /tmp/pr-$N-review.md /tmp/pr-$N-review.err \
  /tmp/pr-$N-review.exit </dev/null >/dev/null 2>&1 &
```

## Wait, then collect

Minutes, not seconds, and stdout stays empty until the end: poll `tail /tmp/pr-$N-review.err` and the
transcript (`ls -t ~/.pi/agent/sessions/*/*$S*.jsonl`). Success is all three of `exit=0`, a non-empty
stdout, and the comment on the PR. Give a failed run one retry with the default reviewer, then stop
and say so — never write the review yourself and present it as independent.

```bash
gh pr view $N --json comments,reviews -q '.comments[],.reviews[] | "--- \(.author.login)\n\(.body)"'
git branch --show-current; git worktree list; git status --short   # left as it was found?
```

## Evaluate, then fix

- **Recompute every number** before it changes code, and classify each finding: must fix, correct but
  overstated, taste call, or wrong — with the evidence for your call.
- **Prefer the smallest change that answers it.** A suggested fix can be worse than the bug, or trade
  away what the feature is for; measure both before choosing.
- **Discuss before big changes**, fix the rest in a worktree per `AGENTS.md`, and never weaken a test
  to satisfy a review. Report what you did not fix, and why.
