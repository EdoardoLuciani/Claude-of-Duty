---
name: merge-pr
description: Squash-merges a pull request into develop and closes the open same-repo issues named by closing keywords in its body. Use only when the user runs /skill:merge-pr with a pull request number or URL.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

# Merge a pull request and close its issues

`bash .agents/skills/merge-pr/scripts/merge-pr.sh <pr-link-or-number>`

Squash-merges that pull request into `develop` and closes the open issues in this repo named by a closing keyword in its body. Report what the script prints.
