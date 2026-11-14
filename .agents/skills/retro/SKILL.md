---
name: retro
description: "Conduct a retrospective on a coding session."
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
  source: "https://github.com/mattpocock/skills/tree/5863806dd4e15c63174bee4e7515a4256792ecfa/skills/engineering/retro"
---

The user has asked for a **retrospective**. You are suggesting improvements to the coding agent's **environment** to improve future runs.

This is a recommendations-only workflow. Present proposals; wait for explicit approval before editing files, installing tools, changing configuration, or delegating work. Repository rules, including protected paths and the selective-testing policy, take precedence.

## Steps

1. Read the repository's `AGENTS.md` and relevant documentation. Keep recommendations concise, reference existing sources instead of duplicating them, and prefer improving an existing instruction or tool over adding another one. This standalone adaptation does not require the upstream `writing-for-agents` skill.

2. Read the primary sources for the session the user specifies. This may mean searching through session logs on this machine. If the user doesn't specify a session, default to the current one. Limit inspection to that session and relevant artifacts; redact secrets and personal information from quoted evidence. If the requested session is unavailable, state the limitation and ask for it rather than inventing findings.

3. Look for candidates for improvement in these categories.

- **Navigation**: how easy was it for the agent to find the right files? Are there hidden dependencies between files? Would a **navigation pointer** make it easier? _Use when_ the session took a long time to find a piece of information.
- **Automated checks**: are there automated checks that could catch errors the agent made? Linting, typing, tests, filesystem linters? Read the repo's own check command first (its `package.json`/build-tool `lint`/`check` scripts, its CI workflow), so a check that already exists but sits unwired or silently broken is the finding, not a reinvention. A repo with no **guardrail** (no pre-commit hook and no CI job running its lint/typecheck/test command) is itself a finding: an un-linted repo is a standing missed opportunity, not a neutral default. _Use when_ the agent made a mistake an automated check could have caught, or the repo has no guardrail at all.
- **Coding standards**: should the **reviewer agent** be given a new rule to enforce? Should an existing rule be removed or clarified? Classify the violation first: a **mechanical** one (a fixed syntactic pattern, a banned API, an import shape, a file-location rule) is a candidate for a deterministic check: a custom rule in the repo's own linter, a pre-commit hook, or a CI job, whichever the repo's language and existing guardrail make cheapest. Prefer an existing check over a new rule. Reserve judgement-based guidance for cross-file consistency, "matches the surrounding style," and anything no guardrail could substitute for. _Use when_ the reviewer agent failed to catch a mistake.
- **Global AGENTS.md**: are there any steering instructions that should be moved to coding standards (or automated checks) instead? _Use when_ the AGENTS.md file is particularly large - in the repo OR the user's global scope.
- **Tool economy**: did the agent make expensive tool calls that could be streamlined? Is there any custom tooling (CLI's, MCP's) that is particularly token-inefficient? _Use when_ the agent made an expensive tool call.
- **No-ops**: look for instructions in steering files that don't modify the agent's behavior. _Use when_ the steering files are large and unwieldy.
- **Information access**: look for opportunities to increase the agent's access to information. Teeing dev server logs, readonly access to third-party services. _Use when_ a crucial piece of information was not available to the agent.

4. Present these candidates to the user, in order of severity. For each, cite session evidence (an artifact, command, or observed mistake), propose the smallest concrete improvement and its target file/tool, and explain the expected benefit and effort. Separate observed problems from speculative opportunities. An empty shortlist is valid when nothing actionable is supported by the session.

## Reference

### Implementation vs Review

Remember that all work goes through two stages: implementation and review. The implementation agent has the most **context pressure**. They are responsible for exploration, writing code, and debugging failures.

The review agent has the least context pressure - it receives a diff, so no exploration needed. It often does not need to write code or debug.

This means that the review agent should be responsible for imposing coding standards, not the implementation agent.

### Files

Check which of these files actually exist; follow the repo's conventions rather than creating a new documentation layout:

- `CLAUDE.md`/`AGENTS.md`: these files are pushed to the context window of any agent working in this repo. They should be used incredibly sparingly, usually only for **navigation pointers** to other files. Proposals affecting protected files require explicit approval.
- `ARCHITECTURE.md`: this repo's subsystem ownership, APIs and event contracts. Reference it rather than duplicating its rules.
- `CODING_STANDARDS.md`: if present, consult it for review guidance; otherwise use existing standards sources. Prefer navigation pointers when reference material becomes unwieldy.
- Docs: use docs as references files, pointed to by other files. Look for existing docs before writing new ones.
- Skills: use skills for reusable workflows or user-invoked commands. Keep instructions focused and dependencies explicit.
