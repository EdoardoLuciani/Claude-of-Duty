# AI Pipeline — Manual GitHub Setup

One-time repository configuration. Run the scripts in
`scripts/ai-pipeline/` (each is idempotent and safe to re-run) or follow the
manual steps. The scripts use your `gh` CLI login (the owner account).

## 1. Labels

```bash
bash scripts/ai-pipeline/create-labels.sh
```

Creates: `ai-ready`, `ai-working`, `ai-pr-open`, `ai-reviewing`,
`ai-fix-needed`, `ai-approved`, `ai-needs-human`, `ai-failed`.

## 2. Branches

```bash
bash scripts/ai-pipeline/create-develop.sh
```

Creates `develop` from the current `main` (no-op if it exists).

## 3. Rulesets (branch protection)

```bash
bash scripts/ai-pipeline/apply-rulesets.sh
```

| Branch | Rules |
|---|---|
| `main` | require PR, block direct pushes, block force pushes, block deletions, no workflow bypass |
| `develop` | require PR, block force pushes, block deletions |

Notes:

- The rulesets apply to admins too (no admin bypass configured) — `main` and
  `develop` are only reachable through PRs. `agent/*` branches are
  unprotected on purpose (autonomous work).
- Required status checks are intentionally **not** configured on `develop` in
  v1 to avoid check-name fragility; the deterministic merge gate enforces CI
  success itself. To add them later: require `Validate / build` on `develop`.
- Verify with: `gh api /repos/{owner}/{repo}/rulesets`.

## 4. Secrets

```bash
bash scripts/ai-pipeline/set-secrets.sh
```

The script prompts for values via `gh secret set` (values are never echoed and
never committed).

| Secret | Used by | Value |
|---|---|---|
| `CODEX_API_KEY` | AI Implement / AI Fix agent jobs | your **OpenCode Go** API key from https://opencode.ai/auth (billing plan). The name is `CODEX_API_KEY` because the pinned gh-aw pi engine's `codex` backend requires that env var name; the value is the OpenCode Go key — see [SECURITY.md](SECURITY.md). |
| `OPENROUTER_API_KEY` | AI Review review job (kimi-k3) | your OpenRouter API key from https://openrouter.ai/keys |
| `AI_CI_TRIGGER_TOKEN` | AI Implement / AI Fix PR creation; AI Develop to Main | fine-grained PAT, **Contents: Read & Write**, restricted to this repository. Needed because PRs created with the default `GITHUB_TOKEN` do not trigger CI. |

There is deliberately **no** `OPENAI_API_KEY` and no `CODEX_AUTH_JSON` (the
reviewer runs on OpenRouter, not ChatGPT-managed Codex auth).

## 5. Variables

| Variable | Value | Purpose |
|---|---|---|
| `AI_MERGE_ENABLED` | `false` initially | Rollout switch for the merge gate (Phase 7). Set to `true` only after the earlier phases behave reliably. |

```bash
gh variable set AI_MERGE_ENABLED --body false
```

## 6. Verify

```bash
bash scripts/ai-pipeline/verify-setup.sh
```

Checks: develop branch exists, all labels exist, rulesets present, required
secrets set (by name — never prints values), gh-aw workflows compile.

## Owner identity

The pipeline hardcodes the owner login (`EdoardoLuciani`) in:

- `agent-implement.md` / `agent-fix.md` — activation sender checks
- `.github/scripts/ai-review/review.py` — `OWNER` constant

Only that account's `ai-ready` application starts the implementation agent
(`roles: [admin]` + explicit `sender.login` check).

## Rollout phases (spec §32)

1. **Branches & protections** — this PR + steps 2–3. Verify agents cannot
   merge into `main`.
2. **Owner authorization** — labels + secrets. Test that a non-owner applying
   `ai-ready` skips the privileged job.
3. **Implementation only** — dry-run one issue with `AI_MERGE_ENABLED=false`
   (PR is created, nothing merges).
4. **CI** — `Validate` passes independently.
5. **Reviewer** — kimi-k3 review job runs; verify the review job executes no
   project code.
6. **Fix loop** — introduce a blocking finding on purpose; verify one fix
   round.
7. **Auto-merge into develop** — set `AI_MERGE_ENABLED=true` only after 1–6
   behave reliably.

See [TESTING.md](TESTING.md) for the concrete security/acceptance tests.
