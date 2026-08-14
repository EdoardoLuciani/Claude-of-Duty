# AI Pipeline — Security

This document states the threat model, the controls, and the residual risks of
the autonomous pipeline. Read it before enabling automatic merges.

## Threat model (spec §5)

Untrusted:

- issue titles, bodies, comments (any GitHub user can open issues on this
  public repository and comment on them)
- arbitrary public PRs and PR comments
- repository content submitted through external forks
- code, manifests, and build scripts on any branch

Trusted:

- the repository owner's application of the `ai-ready` label
- the owner's manual merges of `develop` → `main`
- the deterministic workflows and gates in `.github/workflows/`
- the vendored driver and review tooling in `.github/` (human-reviewed)

Authorization means: *the owner has inspected this issue and intentionally
chosen to let an agent attempt it.* It does NOT make issue content or later
comments trusted.

## Controls

### 1. Owner-only activation (spec §4)

- `AI Implement` triggers only on `issues: labeled` with `names: [ai-ready]`
  and `roles: [admin]` (the owner is the repo admin).
- The activation job additionally hard-fails unless
  `github.event.sender.login == 'EdoardoLuciani'`; the agent job has a second
  `if:` guard with the same check.
- Any other user applying `ai-ready`: the role check cancels the workflow
  before anything privileged runs (Test B).
- No issue event, comment event, or arbitrary PR event can start an agent.
  The fix workflow is gated on the `ai-fix-needed` label, which only the
  pipeline controller (or the owner) can apply.

### 2. PR provenance chain (spec §18)

`AI Review` and `AI Merge Gate` verify, deterministically and before touching
anything sensitive:

```
base branch == develop
head branch starts with agent/
head repository == this repository
PR open, not draft
PR carries the ai-pr-open label (only the pipeline's permission-separated
  safe-outputs job can apply it — random contributors cannot label PRs)
PR carries no ai-needs-human / ai-failed label
originating issue (Fixes #N) exists, is open, and still carries the
  owner-applied ai-ready label
```

`workflow_run`-triggered jobs resolve the PR from the head SHA and exit
early (fail closed) for anything that does not match. A fork PR or a random
PR never reaches the review step, the checkout of its head, or the
credential-bearing step (Test D).

### 3. Separation of model credentials from repo-write credentials (spec §17/§28)

- `OPENROUTER_API_KEY` exists on exactly ONE step (`review` job of
  `AI Review`), which has `contents/pull-requests/issues: read` only.
- The `publish` job (pull-requests/issues write) has no model credentials.
- The merge gate (contents write) has no model credentials.
- The implementation agent job has a read-only `GITHUB_TOKEN`; PR creation
  happens in gh-aw's separate `safe_outputs` job (contents+PRs write, no
  model credentials).
- `AI_CI_TRIGGER_TOKEN` (write-capable PAT) is used only for the CI-trigger
  empty commit and the develop→main keeper PR; it never sits in a job that
  runs an agent.

### 4. The review job never executes project code (spec §16, Test E)

The `AI Review` `review` job:

- checks out the agent branch only AFTER provenance passes, and into
  `pr-checkout/` — the workspace root keeps the trusted main-branch tooling,
  so `review.py`/the extension always run from the main checkout and branch
  content is never executed;
- runs NO `npm ci`/`install`/`test`/`build`, no project scripts, no git hooks
  (`core.hooksPath /dev/null`);
- installs the reviewer CLI globally (`npm i -g @earendil-works/pi-coding-agent@0.84.1`);
- runs the reviewer with tools allowlisted to `read,glob,grep` plus four
  allowlisted read-only `gh_*` fetchers (`.github/extensions/gh-readonly.cjs`):
  `gh_pr_view`, `gh_pr_diff`, `gh_issue_view`, `gh_check_runs`. There is no
  bash tool and no arbitrary `gh`/command passthrough, so a prompt-injected PR
  cannot make the reviewer execute anything;
- uses `--no-context-files --no-skills --no-extensions` so repository files
  cannot inject instructions into the reviewer (the gh extension is loaded
  explicitly);
- records every `gh_*` tool call in an audit log uploaded as an artifact, so
  what the reviewer fetched is reconstructable;
- keeps the API key in a single step env, unset after use; runners are
  ephemeral; nothing is cached; no artifacts contain credentials.

### 5. Implementation agent credential hygiene

- The OpenCode Go key lives in the driver process only (a `getApiKey`
  closure). The agent's shell environment is scrubbed of `*API_KEY*`,
  `*TOKEN*`, `*SECRET*`, `*PASSWORD*` variables (verified by test).
- The model key never appears in logs, comments, or generated files
  (gh-aw masks/secrets-redaction applies to workflow logs).

### 6. `main` is a hard trust boundary (spec §3, Test J)

- Rulesets: PR-only, no force-push, no deletion on `main` and `develop`.
- The merge gate verifies `base == develop` FIRST and refuses anything else.
- No workflow in this repository merges into `main`. The develop→main PR is
  maintained automatically but merged only by the owner.
- `create-pull-request` safe outputs pin `base-branch: develop` and
  `allowed-branches: [agent/*]`.

### 7. Deterministic merge gate (spec §24, Tests F–I)

Merging is decided by ordinary program logic (`AI Merge Gate`), never by an
LLM. Conditions: rollout switch `AI_MERGE_ENABLED`, base==develop, provenance
labels, not draft, CI green at head SHA, review artifact valid JSON with
verdict `approve` and zero blocking findings **reviewed exactly at the head
SHA**, fix rounds ≤ 2, no open `CHANGES_REQUESTED` review (e.g. gh-aw
protected-files requests). Anything unexpected → no merge. Invalid/missing
review output → review workflow fails → merge gate never fires (fail closed).

### 8. Bounded iteration (spec §11/§22)

- Implementation: ≤ 3 meaningful failure-recovery cycles (prompt-level) + a
  hard `max-turns` cap (driver aborts) + workflow `timeout-minutes`.
- Fix loop: ≤ 2 rounds, counted deterministically from the PR timeline
  (`ai-fix-needed` label events). Exhaustion → `ai-needs-human`, no merge.
- Review: one review per head SHA (duplicates skipped), 25-minute step
  timeout.

## Known risks / accepted deviations

1. **ChatGPT-managed Codex auth is NOT used.** The original design used Codex
   CLI + ChatGPT-managed `auth.json`. This implementation reviews with
   **kimi-k3 via OpenRouter** (`OPENROUTER_API_KEY`, API billing) instead —
   simpler, no auth-refresh caveats, and the isolation rule (credential job
   never executes project code) is enforced at least as strictly. OpenAI
   recommends API keys rather than ChatGPT-managed auth for public CI anyway;
   here we use a plain API key with strict job separation.
2. **gh-aw sandbox firewall is disabled** for the two agent workflows
   (BYOK opencode-go cannot route through the AWF gateway). Compensating
   controls: owner-only triggers, read-only agent tokens, scrubbed shell env,
   ephemeral runners, deterministic gates downstream.
3. **The reviewer could in principle read its own process environment**
   (no bash tool means it cannot exfiltrate anything: there is no network tool
   and its only output channel is the human-visible review comment). The gh
   token and the OpenRouter key are therefore still confined to the single
   review step and unset immediately after the run.
4. **The implementation agent can read the repository and run its build
   commands** (that is its job). A prompt-injected malicious issue could in
   principle make it run arbitrary commands on an ephemeral GitHub-hosted
   runner. Blast radius: the OpenCode Go key (credit burn — mitigable by key
   rotation) and public code. The agent token is read-only; no other secrets
   exist in that job; the runner is destroyed afterwards. The workflow prompt
   and AGENTS.md explicitly forbid acting on untrusted content.
4. **The reviewer sees repository content** (the diff). It is instructed that
   all repo content is untrusted data; it has no execution tools, so even a
   malicious diff cannot cause code execution in the credential-bearing job.
5. **AI_CI_TRIGGER_TOKEN** is a write-capable PAT. It is used only in
   deterministic jobs (safe-outputs, keeper PR) and is not present in any
   agent job. Keep it fine-grained (contents: read+write, one repo).
6. **OpenRouter API billing**: the reviewer consumes the owner's OpenRouter
   credits. The review job is restricted to provenance-verified PRs and one
   review per head SHA; step timeout bounds cost.

## What a bad decision costs

Per the final design principle: a bad decision by any agent produces **a
failed PR** (visible, revertible, merge-gated), never a credential compromise
or bad code on `main`. The only autonomous merge path is the deterministic
gate into `develop`; `main` always requires human review and merge.
