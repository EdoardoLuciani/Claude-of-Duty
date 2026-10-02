import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const mergeScript = join(root, '.agents/skills/merge-pr/scripts/merge-pr.sh');
const reviewScript = join(root, '.agents/skills/pr-review/scripts/launch-review.sh');

function run(cmd, args, extra = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', cwd: root, ...extra });
}

function parseRefs(body) {
  const r = run('bash', ['-c', `
    source ${JSON.stringify(mergeScript)}
    printf '%s' "$BODY" | parse_closing_refs
  `], { env: { ...process.env, BODY: body } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

assert.equal(parseRefs('Fixes #345\nCloses: #10\nRESOLVES #3\nfixed #4'), '#345\n#10\n#3\n#4');
assert.equal(parseRefs('Fixes:#8'), '#8');
assert.equal(parseRefs('Fixes#8'), '');
assert.equal(parseRefs('See #132 and postfix #1'), '');
assert.equal(parseRefs('fixed the bug in #10'), '');
assert.equal(parseRefs('Fixes #10, fixes #11\nFixes #10'), '#10\n#11');
assert.equal(parseRefs('Fixes #10 and #11'), '#10');
assert.equal(parseRefs('Fixes other/repo#9\nFixes EdoardoLuciani/Claude-of-Duty#345'), 'other/repo#9\nEdoardoLuciani/Claude-of-Duty#345');
assert.equal(parseRefs(''), '');

const branch = run('git', ['branch', '--show-current']).stdout.trim();
const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
const parent = run('git', ['rev-parse', 'HEAD^']).stdout.trim();
assert.ok(branch, 'smoke needs a named branch');

function fakeBin(dir, pr, opts = {}) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'gh.log');
  writeFileSync(join(dir, 'pr.json'), JSON.stringify(pr));
  writeFileSync(join(dir, 'runs.json'), JSON.stringify({
    workflow_runs: [{ name: 'Validate', conclusion: opts.ci ?? 'success' }],
  }));
  for (const [num, issue] of Object.entries(opts.issues ?? {})) {
    writeFileSync(join(dir, `issue-${num}.json`), JSON.stringify(issue));
  }
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = "repo" ]; then
  echo '{"nameWithOwner":"EdoardoLuciani/Claude-of-Duty"}'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat ${JSON.stringify(join(dir, 'pr.json'))}
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then
  if [ "${opts.allowWrite ? '1' : ''}" != "1" ]; then echo "merge blocked" >&2; exit 99; fi
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--body-file" ]; then
      echo "BODY" >> ${JSON.stringify(log)}
      cat "$arg" >> ${JSON.stringify(log)}
    fi
    prev="$arg"
  done
  exit 0
fi
if [ "$1" = "issue" ]; then
  if [ "${opts.failClose ? '1' : ''}" = "1" ]; then echo "close failed" >&2; exit 1; fi
  if [ "${opts.allowWrite ? '1' : ''}" != "1" ]; then echo "close blocked" >&2; exit 99; fi
  exit 0
fi
if [ "$1" = "api" ]; then
  case "$2" in
    *actions/runs*) cat ${JSON.stringify(join(dir, 'runs.json'))}; exit 0 ;;
    *issues/*)
      num="\${2##*/}"
      file=${JSON.stringify(dir)}/issue-$num.json
      if [ -f "$file" ]; then cat "$file"; exit 0; fi
      echo '{"message":"Not Found"}' >&2
      exit 1
      ;;
  esac
fi
echo "unexpected gh $*" >&2
exit 99
`);
  chmodSync(gh, 0o755);
  return { bin, log };
}

function pr(over = {}) {
  return {
    number: 345,
    url: 'https://github.com/EdoardoLuciani/Claude-of-Duty/pull/345',
    title: 'feat(skills): merge a pull request',
    body: 'Fixes #345\nFixes EdoardoLuciani/Claude-of-Duty#345\nCloses #132\nFixes other/repo#9\nResolves #999\nFixes #340',
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'develop',
    headRefName: 'some-other-branch',
    headRefOid: head,
    reviewDecision: '',
    ...over,
  };
}

const issues = {
  345: { state: 'open' },
  132: { state: 'closed' },
  340: { state: 'open', pull_request: { url: 'https://example/pull/340' } },
};

function merge(args, fixture, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-pr-'));
  const { bin, log } = fakeBin(dir, fixture, opts);
  const r = run('bash', [mergeScript, ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { ...r, log: readFileSync(log, 'utf8') };
}

let r = run('bash', [mergeScript]);
assert.equal(r.status, 2, r.stderr);

r = run('bash', [mergeScript, '1', '--nope']);
assert.equal(r.status, 2, r.stderr);

r = merge(['345', '--dry-run'], pr({ isDraft: true }));
assert.equal(r.status, 1, r.stderr);
assert.match(r.stderr, /draft/);
assert.doesNotMatch(r.log, /pr merge/);

r = merge(['345', '--dry-run'], pr({ baseRefName: 'main' }));
assert.equal(r.status, 1, r.stderr);
assert.match(r.stderr, /develop/);

r = merge(['345', '--dry-run'], pr({ body: 'See #345' }));
assert.equal(r.status, 1);
assert.match(r.stderr, /no closing keyword/);

r = merge(['345', '--dry-run'], pr(), { ci: 'failure', issues });
assert.equal(r.status, 1);
assert.match(r.stderr, /Validate/);
assert.doesNotMatch(r.log, /issues\/345/);

r = merge(['345', '--dry-run'], pr({ reviewDecision: 'CHANGES_REQUESTED' }), { issues });
assert.equal(r.status, 1);
assert.match(r.stderr, /changes-requested/);

r = merge(['345', '--dry-run'], pr(), { issues });
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.equal((r.stdout.match(/close: #345/g) || []).length, 1);
assert.match(r.stdout, /skip: #132 not open/);
assert.match(r.stdout, /skip: other\/repo#9 other repository/);
assert.match(r.stdout, /skip: #999 not found/);
assert.match(r.stdout, /skip: #340 pull request/);
assert.match(r.stdout, /squash-title: feat\(skills\): merge a pull request/);
assert.match(r.stdout, /Fixes #345\nSee PR #345\./);
assert.doesNotMatch(r.stdout, /Fixes #132/);
assert.match(r.stdout, /dry-run: no writes/);
assert.doesNotMatch(r.log, /pr merge/);
assert.doesNotMatch(r.log, /^issue /m);

r = merge(['345', '--dry-run'], pr({ headRefName: branch, headRefOid: parent }), { issues });
assert.equal(r.status, 1, r.stdout);
assert.match(r.stderr, /commits that are not on the pull request/);

r = merge(['345', '--dry-run'], pr({ headRefName: branch, headRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }), { issues });
assert.equal(r.status, 1);
assert.match(r.stderr, /cannot compare/);

r = merge(['345', '--dry-run'], pr({ headRefName: branch, headRefOid: head }), { issues });
assert.equal(r.status, 0, r.stderr);

r = merge(['345', '--dry-run'], pr({ body: 'Fixes #999' }));
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.match(r.stdout, /close: none/);
assert.match(r.stdout, /skip: #999 not found/);
assert.match(r.stdout, /See PR #345\./);
assert.doesNotMatch(r.stdout, /Fixes #/);
assert.match(r.stdout, /dry-run: no writes/);

r = merge(['345'], pr(), { issues, allowWrite: true });
assert.equal(r.status, 0, r.stderr + r.stdout);
assert.match(r.log, /pr merge 345 --repo EdoardoLuciani\/Claude-of-Duty --squash --match-head-commit \S+ --subject=feat\(skills\): merge a pull request --body-file /);
assert.doesNotMatch(r.log, /--admin/);
assert.doesNotMatch(r.log, /--delete-branch/);
assert.match(r.log, /issue close 345 --repo EdoardoLuciani\/Claude-of-Duty --reason completed --comment Closed after squash-merging PR #345 into develop\./);
assert.doesNotMatch(r.log, /issue close 132/);
assert.match(r.stdout, /merged: yes/);
assert.match(r.stdout, /closed: #345/);
assert.match(r.log, /BODY\nFixes #345\nSee PR #345\.\n/);

r = merge(['345'], pr(), { issues, allowWrite: true, failClose: true });
assert.equal(r.status, 1, r.stdout);
assert.match(r.stdout, /merged: yes/);
assert.match(r.stderr, /close-failed: #345/);
assert.match(r.stderr, /do not merge again/);
assert.match(r.log, /pr merge /);

const promptDir = mkdtempSync(join(tmpdir(), 'review-prompt-'));
const withAddendum = join(promptDir, 'with.md');
const without = join(promptDir, 'without.md');
r = run('bash', ['-c', `
  source ${JSON.stringify(reviewScript)}
  write_prompt ${JSON.stringify(withAddendum)} "https://example/pull/1" 1 'Is $(echo PWNED) the gate wrong?'
  write_prompt ${JSON.stringify(without)} "https://example/pull/1" 1 ""
`]);
assert.equal(r.status, 0, r.stderr);
const prompted = readFileSync(withAddendum, 'utf8');
assert.match(prompted, /Review this PR: https:\/\/example\/pull\/1/);
assert.match(prompted, /Do not edit, commit or push\./);
assert.match(prompted, /Answer each one in the review you post/);
assert.match(prompted, /Do not add a separate section that reprints the questions/);
assert.match(prompted, /Is \$\(echo PWNED\) the gate wrong\?/);
assert.doesNotMatch(prompted, /Is PWNED the gate/);
assert.doesNotMatch(readFileSync(without, 'utf8'), /author attached questions/);

r = run('bash', [reviewScript, '--addendum']);
assert.equal(r.status, 2, r.stderr);
r = run('bash', [reviewScript, '--addendum', 'a question']);
assert.equal(r.status, 2, r.stderr);

console.log('smoke-merge-pr: ok');
