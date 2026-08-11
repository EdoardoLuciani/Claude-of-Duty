# AI Pipeline — Testing

Evidence and instructions for the security tests (spec §33) and the first
end-to-end acceptance test (spec §34).

## What has been verified in this PR

### Compile-time / static

- `gh aw compile agent-implement agent-fix` succeeds (v0.85.4, pinned). Both
  lock files are committed. The compiler auto-injects: owner sender checks,
  role allowlist (admin), `ai-ready` label filter, safe-outputs config
  (base `develop`, branches `agent/*`, labels, CI-trigger token), pinned pi
  install, and the vendored driver invocation.
- All hand-written workflows parse as valid YAML; `review.py` compiles.
- `validate.yml` runs `npm ci && npm test && npm run build` with no secrets.

### Driver (vendored pi engine driver) — local harness with a mock LLM server

A mock OpenAI-compatible SSE server (`/tmp` harness, not committed) exercised
the driver end-to-end:

| Check | Result |
|---|---|
| Agent loop runs (assistant → tool call → tool result → finish) | ✅ |
| bash tool actually executes commands | ✅ (`echo hello-from-mock`) |
| Auth flows via the driver closure (Bearer <key> seen by mock) | ✅ |
| **Credential scrubbing**: `env \| grep -c fake-key` inside the agent's shell returns 0 matches | ✅ |
| Protocol check: session without `create_pull_request` → exit 1 | ✅ |
| Protocol check: `safeoutputs create_pull_request` invoked (succeeds) → exit 0 | ✅ |
| Tool failure → exit 1 (fail closed) | ✅ |
| Turn/token accounting in gh-aw-compatible JSONL | ✅ |

### Review controller (`review.py`) — local unit checks

| Check | Result |
|---|---|
| Valid fenced JSON review → parsed, `reviewed_sha`/`pr_number` added | ✅ |
| Prose-only output (no JSON) → exit 1, "fail closed" | ✅ |
| `changes_requested` with blocking findings → accepted as valid data | ✅ |

## Required security tests (spec §33) — run these on the live repo

| Test | Scenario | Expected | How to verify |
|---|---|---|---|
| A | Random public issue, no `ai-ready` | nothing privileged runs | no `AI Implement` run appears |
| B | Someone other than the owner applies `ai-ready` | privileged job skipped | run exists but `agent` job skipped; activation logs the error |
| C | Owner applies `ai-ready` | implementation starts | `agent` job runs the driver |
| D | Random fork opens a PR into `develop` | `OPENROUTER_API_KEY` never exposed | `AI Review` run exists but `review` job's reviewer step skipped (provenance) — no pi invocation |
| E | PR branch contains a "malicious" build/test command trying to read credentials | code never executed in the review job | review job runs no project scripts by construction; reviewer has no bash tool; verify no npm project install step in `ai-review.yml` |
| F | Reviewer returns invalid JSON | merge blocked | `parse` step exits 1 → `AI Review` run red → merge gate not triggered |
| G | CI fails | merge blocked | `AI Review` requests a fix instead of reviewing; gate requires green CI |
| H | Reviewer reports BLOCKING findings | merge blocked; fix loop starts | publish job adds `ai-fix-needed`; `AI Fix` runs |
| I | Everything passes | squash merge into develop | gate merges when `AI_MERGE_ENABLED=true` |
| J | PR targets main | never auto-merge | gate's first check refuses; no workflow merges to main |

## First end-to-end acceptance test (spec §34)

Procedure (after MANUAL-SETUP.md, with `AI_MERGE_ENABLED=false` for steps 1–18
and `true` only for step 18):

1. Open a deliberately small issue with explicit acceptance criteria
   (example: "Add a `--version` flag to `tools/smoke-market.mjs` printing the
   package version, with a smoke assertion"). Include a checklist.
2. Owner applies `ai-ready`.
3. Confirm authorization identifies the owner (run log, activation step).
4. Confirm the pi agent starts (driver log line, model
   `opencode-go/deepseek-v4-flash`, `thinking=max`).
5. Confirm branch `agent/issue-N-<desc>` is created.
6. Confirm implementation occurs (PR diff).
7. Confirm `npm test`/`npm run build` pass in the agent session.
8. Confirm the simplification pass happens (PR body/agent log — instructed
   explicitly; verify the diff is minimal).
9. Confirm the PR targets `develop` (safe-outputs config enforces it).
10. Confirm `Validate` runs without model credentials (workflow has no secrets).
11. Confirm `AI Review` starts only after provenance checks (run log).
12. Confirm the reviewer model is `openrouter/moonshotai/kimi-k3` with
    `--thinking high` (step log).
13. Confirm the review job executes no project code (inspect `ai-review.yml`;
    check no project installs run in the run log).
14. Confirm structured review JSON output (comment marker
    `<!-- ai-review-result -->`, validated).
15. Intentionally produce one review failure (e.g. add a real bug in step 4's
    implementation or ask the reviewer to demand a fix) — confirm
    `ai-fix-needed` is applied and no merge happens.
16. Confirm the implementation agent fixes it (`AI Fix` run, push to branch).
17. Confirm CI reruns and the reviewer re-reviews the new head SHA.
18. With `AI_MERGE_ENABLED=true`: confirm clean PR squash-merges into develop.
19. Confirm `main` is untouched (`git log origin/main`).
20. Confirm the develop→main PR exists, is refreshed, and was NOT merged.

## Regression checklist after any pipeline change

- [ ] `bash scripts/ai-pipeline/verify-setup.sh` passes
- [ ] `gh aw compile` produces no errors; lock files committed
- [ ] No workflow contains both model credentials and repo-write permissions
- [ ] No `pull_request_target`, no untrusted-ref checkout with secrets
- [ ] Merge gate still refuses base != develop (first gate)
