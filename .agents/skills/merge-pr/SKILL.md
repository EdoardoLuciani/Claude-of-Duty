---
name: merge-pr
description: Squash-merges a pull request into develop and closes the open same-repo issues named by closing keywords in its body. Use only when the user runs /skill:merge-pr with a pull request number or URL.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

# Merge a pull request and close its issues

Squash-merges one pull request into `develop`, then closes the open issues in
this repo that its body names with a closing keyword. GitHub will not do that
itself: `develop` is not the default branch, so those keywords are not links.

## Run it

`bash .agents/skills/merge-pr/scripts/merge-pr.sh <pr-link-or-number>`

A number or URL is required. `--dry-run` checks the same gates and prints the
plan without merging or closing.

The script refuses before any write unless all of these hold:

- the pull request is open, not a draft, and targets `develop`
- its body has at least one closing keyword (`fix`/`close`/`resolve`, including
  `fixes`, `fixed`, `closes`, `closed`, `resolves`, `resolved`, optional colon)
- the latest Validate run on that head, for `pull_request`, succeeded
- review decision is not `CHANGES_REQUESTED`
- if that head branch is the current checkout, it has no commits that are not
  already on the pull request

It does not push, does not use admin rights, and does not delete the branch.
The repository deletes the remote head on merge.

Any keyword that is not an open issue in this repo is skipped and printed.
That does not block the merge. No keyword at all does: the script stops.

The squash title is the pull request title. The body is a `Fixes #N` line for
each issue this run will close, then `See PR #N`. Skipped numbers are not
written into that commit.

## After it runs

Report what it merged, closed, and skipped. If it prints `merged: yes` and a
close failed, do not run it again. Say which issue is still open.
