import assert from 'node:assert/strict';

import { publishRelease } from '../../tools/release.mjs';

const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const repo = { owner: 'example', repo: 'game' };
const fullName = 'example/game';

function fixture() {
  const context = {
    eventName: 'pull_request',
    repo,
    payload: {
      action: 'closed',
      pull_request: {
        merged: true,
        merge_commit_sha: sha,
        base: { ref: 'main', repo: { full_name: fullName } },
        head: { ref: 'develop', repo: { full_name: fullName } },
      },
    },
  };
  const state = {
    pkg: { version: '1.1.0' },
    lock: { version: '1.1.0', packages: { '': { version: '1.1.0' } } },
    ref: null,
    release: null,
    failures: {},
  };
  const calls = [];
  const method = (name, fn) => async (args) => {
    calls.push({ name, args });
    if (state.failures[name])
      throw Object.assign(new Error(name), { status: state.failures[name] });
    const data = fn(args);
    if (!data) throw Object.assign(new Error('Not found'), { status: 404 });
    return { data };
  };
  const github = {
    rest: {
      git: {
        getRef: method('getRef', () => state.ref),
        getTag: method('getTag', () => ({ object: { type: 'commit', sha } })),
        createRef: method('createRef', (args) => {
          state.ref = { object: { type: 'commit', sha: args.sha } };
          return state.ref;
        }),
      },
      repos: {
        getContent: method('getContent', ({ path }) => ({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(
            JSON.stringify(path === 'package.json' ? state.pkg : state.lock)
          ).toString('base64'),
        })),
        getReleaseByTag: method('getReleaseByTag', () => state.release),
        createRelease: method('createRelease', () => {
          state.release = {
            html_url: 'https://example.test/releases/v1.1.0',
            draft: false,
            prerelease: false,
          };
          return state.release;
        }),
      },
    },
  };
  return { context, state, calls, run: () => publishRelease(github, context) };
}

// Pin every read/write to the merged commit, not whichever branch head is current.
{
  const f = fixture();
  const release = await f.run();
  assert.equal(release, f.state.release);
  assert.deepEqual(
    f.calls.filter((c) => c.name === 'getContent').map((c) => c.args),
    [
      { ...repo, path: 'package.json', ref: sha },
      { ...repo, path: 'package-lock.json', ref: sha },
    ]
  );
  assert.deepEqual(f.calls.find((c) => c.name === 'createRef').args, {
    ...repo,
    ref: 'refs/tags/v1.1.0',
    sha,
  });
  assert.deepEqual(f.calls.find((c) => c.name === 'createRelease').args, {
    ...repo,
    tag_name: 'v1.1.0',
    target_commitish: sha,
    name: 'v1.1.0',
    generate_release_notes: true,
    draft: false,
    prerelease: false,
  });
  await f.run();
  assert.equal(f.calls.filter((c) => c.name === 'createRef').length, 1);
  assert.equal(f.calls.filter((c) => c.name === 'createRelease').length, 1);
}

// Never publish for unrelated branches, forks, direct pushes, or unmerged PRs.
for (const change of [
  (c) => {
    c.eventName = 'push';
  },
  (c) => {
    c.payload.action = 'opened';
  },
  (c) => {
    c.payload.pull_request.merged = false;
  },
  (c) => {
    c.payload.pull_request.base.ref = 'develop';
  },
  (c) => {
    c.payload.pull_request.head.ref = 'feature';
  },
  (c) => {
    c.payload.pull_request.head.repo.full_name = 'fork/game';
  },
  (c) => {
    c.payload.pull_request.base.repo.full_name = 'fork/game';
  },
]) {
  const f = fixture();
  change(f.context);
  await assert.rejects(f.run, /merged develop/);
  assert.equal(f.calls.length, 0);
}
{
  const f = fixture();
  f.context.payload.pull_request.merge_commit_sha = 'main';
  await assert.rejects(f.run, /merge commit SHA/);
  assert.equal(f.calls.length, 0);
}
for (const version of ['01.1.0', '1.1', 'v1.1.0', '1.1.0-beta.1', '1.1.0+build', '', null]) {
  const f = fixture();
  f.state.pkg.version = version;
  await assert.rejects(f.run, /stable MAJOR.MINOR.PATCH/);
  assert(!f.calls.some((c) => c.name === 'createRef'));
}
for (const mismatch of [
  (s) => {
    s.lock.version = '1.0.0';
  },
  (s) => {
    s.lock.packages[''].version = '1.0.0';
  },
  (s) => {
    delete s.lock.packages;
  },
]) {
  const f = fixture();
  mismatch(f.state);
  await assert.rejects(f.run, /versions must match/);
  assert(!f.calls.some((c) => c.name === 'createRef'));
}
{
  const f = fixture();
  f.state.ref = { object: { type: 'commit', sha: otherSha } };
  await assert.rejects(f.run, /already points to another commit/);
  assert(!f.calls.some((c) => c.name === 'createRef' || c.name === 'createRelease'));
}
{
  const f = fixture();
  f.state.ref = { object: { type: 'tag', sha: otherSha } };
  await f.run();
  assert(f.calls.some((c) => c.name === 'getTag'));
  assert(!f.calls.some((c) => c.name === 'createRef'));
}

// Retry after partial success without moving/recreating the tag.
{
  const f = fixture();
  f.state.failures.createRelease = 503;
  await assert.rejects(f.run, { status: 503 });
  assert(f.state.ref);
  delete f.state.failures.createRelease;
  await f.run();
  assert.equal(f.calls.filter((c) => c.name === 'createRef').length, 1);
  assert(f.state.release);
}
for (const name of ['getContent', 'getRef', 'getReleaseByTag']) {
  const f = fixture();
  f.state.failures[name] = 403;
  await assert.rejects(f.run, { status: 403 });
  assert(!f.calls.some((c) => c.name === 'createRelease'));
}
for (const flag of ['draft', 'prerelease']) {
  const f = fixture();
  f.state.ref = { object: { type: 'commit', sha } };
  f.state.release = { [flag]: true };
  await assert.rejects(f.run, /review it manually/);
  assert(!f.calls.some((c) => c.name === 'createRelease'));
}
console.log('RELEASE_OK: exact-commit tags, version checks, event guards and safe retries');
