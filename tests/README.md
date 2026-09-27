# Tests

Run from the repository root after `npm ci`.

## Node smoke suite

```bash
npm test
npm test -- -t smoke-heal.mjs
node tests/smoke/smoke-heal.mjs
```

`smoke/smoke.test.mjs` discovers the standalone `smoke-*.mjs` scripts beside it.
Each script runs in a fresh Node process; its exit status is one Vitest result.
No smoke assertions or time limits changed in the directory split.

## Browser/gameplay checks

```bash
npx playwright install chromium
node tests/e2e/market-e2e.mjs
npm run world:smoke
```

`e2e/` contains the former top-level `*-e2e.mjs`, `check-*.mjs`, and
`world-smoke.mjs` scripts. They start/reuse Vite through the shared browser
harness and need Chromium with WebGL2. Run them individually; they are not
included in `npm test` or the default validation CI job. Existing script
arguments and environment variables are unchanged.

## What remains under tools/

Exporters, world validators, captures, profilers, and diagnostic reports remain
under `tools/`. `tools/lib/` and the navigation investigation harness under
`tools/nav240/` remain shared infrastructure used by tests and development tools.
For example, `tools/playtest.mjs` prints observations but does not fail on bad
movement/fire results; moving it into the test suite would imply a guarantee it
does not provide.
