---
name: pr-review
description: Spawns a second pi agent to review a pull request independently — its own model, its own context — then reads the findings back so they can be verified, disputed and acted on. Use when the user asks for an independent or second-agent review of a PR.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

# PR review by a second agent

`bash .agents/skills/pr-review/scripts/launch-review.sh <pr-link-or-number>`

A second pi session, its own model and context, reviews the PR and posts one comment. It is read-only apart from that comment. stdout stays empty until the run ends; poll the transcript and the exit file. Success is exit 0, non-empty stdout, and the comment. One retry, then say it failed. Never write the review yourself and present it as independent.

If you have a concrete doubt, pass `--addendum "one or two short questions"`. No filler and no suggested verdict. Omit it when you have none.

A review is an input, not an instruction. Recompute every number before changing code. Prefer the smallest fix. Discuss before big changes. Never weaken a test to satisfy a review. Report what you did not fix, and why.
