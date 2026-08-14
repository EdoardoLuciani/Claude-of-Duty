# Autonomous issue → develop pipeline

The owner applies `ai-ready` to an issue. A Pi implementation agent opens a PR
into `develop`; normal CI runs; a second Pi process reviews the exact PR commit;
a deterministic gate may squash-merge it into `develop`. Moving `develop` to
`main` is always a manual owner action.

## Workflows

| Workflow | Purpose |
|---|---|
| `agent-implement.md` | gh-aw Pi agent implements an owner-authorized issue and creates an `agent/*` PR |
| `validate.yml` | runs `npm ci`, `npm test`, and `npm run build` |
| `ai-review.yml` | verifies provenance, runs the reviewer, and publishes its result from a separate job |
| `agent-fix.md` | gh-aw Pi agent addresses blocking findings or CI failures, at most twice |
| `ai-merge-gate.yml` | rechecks provenance, CI, review SHA, labels, and human review state before merging to `develop` |

The two agent workflows use gh-aw's built-in Pi engine. OpenCode Go is exposed
as an OpenAI-compatible endpoint:

```yaml
model: openai/deepseek-v4-flash?effort=high
engine:
  id: pi
  version: 0.84.1
  env:
    OPENAI_BASE_URL: https://opencode.ai/zen/go/v1
```

gh-aw's firewall creates the temporary Pi model entry and keeps the API key out
of the agent sandbox. Repository writes are performed by gh-aw safe-output
jobs, not by the model job.

## Reviewer

The reviewer checks out exactly the SHA that passed CI and runs with Pi's
`read`, `grep`, `find`, `ls`, and unrestricted `bash` tools. It can inspect the
whole repository, use the read-only `GH_TOKEN`, install dependencies, and run
code to verify findings. The review job has no GitHub write permission.

`OPENROUTER_API_KEY` is present in the reviewer process and therefore visible
to commands run by the model. This is an explicit simplicity trade-off. Use a
low-limit, repository-specific billing key and rotate it if a review run is
compromised. Publishing labels/comments happens in a separate job without that
key. Merging is never delegated to the model.

## GitHub setup

Configure these once in the GitHub UI or with `gh`; no repository setup script
is required.

1. Create branch `develop` from `main`.
2. Create labels: `ai-ready`, `ai-pr-open`, `ai-fix-needed`,
   `ai-needs-human`.
3. Protect `main` and `develop`: require pull requests; block force-pushes and
   deletion.
4. Add Actions secrets:
   - `CODEX_API_KEY`: OpenCode Go API key. The name is required by gh-aw's
     OpenAI-compatible Pi backend.
   - `OPENROUTER_API_KEY`: reviewer model key.
   - `AI_CI_TRIGGER_TOKEN`: fine-grained PAT restricted to this repository,
     with Contents, Issues, and Pull Requests read/write. It lets safe-output
     commits trigger CI and lets review labels trigger the fix workflow.
5. Set `AI_MERGE_ENABLED=false` until a full dry run succeeds.

Compile agent definitions after changing them:

```bash
gh aw compile agent-implement agent-fix
```

## State and gates

Only four labels are used:

- `ai-ready`: owner authorization on the issue
- `ai-pr-open`: provenance marker applied by the PR safe-output job
- `ai-fix-needed`: triggers and counts fix rounds
- `ai-needs-human`: terminal stop

The merge gate requires all of the following:

- `AI_MERGE_ENABLED=true`
- open, non-draft PR from this repository
- base `develop`, head `agent/*`
- current `ai-pr-open`, no pending/human labels
- open originating issue carrying `ai-ready`
- latest `Validate` run passed at the current head SHA
- valid approving review artifact for that same SHA
- no more than two fix rounds
- no open `CHANGES_REQUESTED` review

Anything missing exits without merging. To re-evaluate a reviewed PR after
enabling merges, manually run `AI Merge Gate` with the successful AI Review run
ID.

## Verification

Before enabling merges:

```bash
gh aw compile agent-implement agent-fix
npm ci
npm test
npm run build
```

Then run one small issue end to end with merging disabled, force one CI/review
failure to exercise the fix loop, enable merging, and manually review the
resulting `develop` branch before opening a `develop` → `main` PR.
