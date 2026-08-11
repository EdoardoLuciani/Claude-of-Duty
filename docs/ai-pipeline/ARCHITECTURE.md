# AI Pipeline — Architecture

Autonomous **issue → develop** pipeline for this repository. GitHub itself is
the orchestration layer: Issues are task specs, labels are authorization/state,
Actions is ephemeral compute, branches/PRs are durable state. The repository
owner retains the final human gate **develop → main**.

```
GitHub issue
   │  OWNER applies `ai-ready`
   ▼
AI Implement (gh-aw workflow, pi engine)          ── owner-only activation
   │  DeepSeek V4 Flash (reasoning effort max) via OpenCode Go
   │  vendored driver: .github/drivers/pi-opencode-go-driver.cjs
   ▼
agent/issue-N-... branch → PR → develop            ── safe-outputs job
   │  (read-only agent token; PR created by permission-separated job)
   ▼
Validate (deterministic CI: npm ci, npm test, build)  ── no model credentials
   │
   ▼
AI Review (pipeline controller)
   ├─ CI passed ──► independent review: kimi-k3 (OpenRouter), reasoning high,
   │                 READ-ONLY tools, NO project code execution
   ├─ CI failed ──► deterministic fix request (ai-fix-needed)
   └─ publish job (labels + comments, NO model credentials)
   │
   ▼
AI Fix (gh-aw workflow, pi engine)                 ── fix loop, max 2 rounds
   │  addresses blocking findings / CI failures on the PR branch
   ▼
AI Review again (per new head SHA)                 ── loop bounded at 2 rounds
   │
   ▼
AI Merge Gate (deterministic, no LLM anywhere)
   │  base==develop ∧ provenance ∧ CI green ∧ review approved ∧
   │  rounds ≤ 2 ∧ no CHANGES_REQUESTED ∧ AI_MERGE_ENABLED
   ▼
squash merge → develop
   │
   ▼
AI Develop to Main (keeper PR, refreshed on every push to develop)
   ▼
main  ◄── HUMAN review and merge (never automated)
```

## Privilege separation (spec §28)

| Stage | Workflow | Model credentials | GitHub write perms |
|---|---|---|---|
| Authorization | AI Implement (activation) | none | none |
| Implementation | AI Implement (agent job) | `CODEX_API_KEY` (OpenCode Go) | **none** — read-only token; scrubbed driver env |
| PR creation | AI Implement (safe-outputs job) | none | contents+PRs write |
| CI | Validate | none | none |
| Review | AI Review (review job) | `OPENROUTER_API_KEY` (kimi-k3) | **none** (read-only) |
| Publishing | AI Review (publish job) | **none** | PRs+issues write |
| Fix | AI Fix | `CODEX_API_KEY` | **none** (read-only token) |
| Merge | AI Merge Gate | **none** | contents+PRs+issues write |
| develop→main PR | AI Develop to Main | **none** | PRs write (+CI-trigger PAT) |

Model credentials and repository-write credentials never coexist in the same
job. The Codex-style rule also holds: the job that holds model credentials
**never executes project code** (see [SECURITY.md](SECURITY.md)).

## Workflow inventory

| Workflow | Source | Trigger | Purpose |
|---|---|---|---|
| `AI Implement` | `agent-implement.md` (gh-aw) → `agent-implement.lock.yml` | issue labeled `ai-ready` by OWNER (roles: admin + sender check) | implements, opens PR → develop |
| `AI Fix` | `agent-fix.md` (gh-aw) → `agent-fix.lock.yml` | PR labeled `ai-fix-needed` | fixes blocking findings / CI failures on the PR branch |
| `Validate` | `validate.yml` | PRs + pushes to main/develop | deterministic CI (no model credentials) |
| `AI Review` | `ai-review.yml` | `Validate` completed | provenance checks, kimi-k3 review or CI-fix request, publishes results |
| `AI Merge Gate` | `ai-merge-gate.yml` | `AI Review` completed | deterministic squash merge into develop |
| `AI Develop to Main` | `ai-develop-to-main.yml` | push to develop | maintains the develop→main PR (never merges) |

## Branch model

- `main` — stable, human-controlled. Ruleset: PR-only, no force-push, no
  deletion. Never touched by the autonomous system.
- `develop` — autonomous integration branch. Created once from `main`.
- `agent/*` — autonomous work branches (one per issue). PRs must target
  `develop`.

## gh-aw integration (spec §7)

Both agent workflows are **gh-aw** (GitHub Agentic Workflows) markdown
workflows compiled with `gh aw compile` (pinned: gh-aw v0.85.4). The compiled
lock files are committed — the repository does not depend on a floating
`main`-branch import. The pi engine driver is **vendored** into the repository
(`.github/drivers/pi-opencode-go-driver.cjs`) and pinned to the pi 0.84.x line
via `engine.version: 0.84.1`; it is adapted from gh-aw v0.85.4's
`pi_agent_core_driver.cjs` with an OpenCode Go provider, `max` reasoning
effort, real tools, credential-scrubbed shell env, turn caps, and a
safe-output protocol check.

## Why the agent sandbox firewall is disabled

gh-aw's AWF firewall cannot route to the BYOK `opencode-go` provider
(opencode.ai is not one of the gateway's supported backends), so
`sandbox.agent: false` is required and `strict: false` follows. The security
posture is preserved by: owner-only activation, read-only agent tokens,
credential scrubbing, ephemeral runners, and the deterministic gates.

## Label state machine

```
ai-ready      owner authorization (persists as provenance)
ai-working    implementation in progress (issue)
ai-pr-open    PR open, created by the pipeline
ai-reviewing  review in progress            (applied by publish job)
ai-approved   latest review approved        (applied by publish job)
ai-fix-needed fix round requested           (applied by publish/CI-fix)
ai-needs-human terminal — human attention   (applied on failure/exhaustion)
ai-failed     reserved for hard failures
```

GitHub's real PR/check/workflow state remains authoritative; labels are
primarily for humans.
