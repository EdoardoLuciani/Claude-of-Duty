import assert from 'node:assert/strict';

// Only a missing resource is recoverable; auth, permissions and network errors fail.
async function optional(request) {
  try {
    return (await request()).data;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

// Invoked by github-script with its authenticated Octokit client and event context.
export async function publishRelease(github, context) {
  const pr = context.payload.pull_request;
  const fullName = `${context.repo.owner}/${context.repo.repo}`;
  assert(
    context.eventName === 'pull_request' &&
      context.payload.action === 'closed' &&
      pr?.merged === true &&
      pr.base.ref === 'main' &&
      pr.head.ref === 'develop' &&
      pr.base.repo.full_name === fullName &&
      pr.head.repo.full_name === fullName,
    'Releases require a merged develop → main PR from this repository'
  );
  const sha = pr.merge_commit_sha;
  assert(/^[a-f0-9]{40}$/.test(sha), 'Missing or invalid merge commit SHA');
  const repo = context.repo;

  // Read both manifests at the event's commit, never the moving main/develop heads.
  async function readJson(path) {
    const { data } = await github.rest.repos.getContent({ ...repo, path, ref: sha });
    assert(data.type === 'file' && data.encoding === 'base64', `Cannot read ${path}`);
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  }
  const pkg = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const version = pkg.version;
  assert(
    typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version),
    'Release version must be stable MAJOR.MINOR.PATCH (for example, 1.1.0)'
  );
  assert(
    lock.version === version && lock.packages?.['']?.version === version,
    'package.json and package-lock.json versions must match'
  );

  const tag = `v${version}`;
  const ref = await optional(() => github.rest.git.getRef({ ...repo, ref: `tags/${tag}` }));
  if (ref) {
    let object = ref.object;
    // Accept existing lightweight or annotated tags, but never move either.
    while (object.type === 'tag') {
      object = (await github.rest.git.getTag({ ...repo, tag_sha: object.sha })).data.object;
    }
    assert(
      object.type === 'commit' && object.sha === sha,
      `${tag} already points to another commit; bump the version before releasing`
    );
  } else {
    await github.rest.git.createRef({ ...repo, ref: `refs/tags/${tag}`, sha });
  }

  // A rerun can finish a release after tag creation, or leave a published release alone.
  const existing = await optional(() => github.rest.repos.getReleaseByTag({ ...repo, tag }));
  if (existing) {
    assert(
      !existing.draft && !existing.prerelease,
      `${tag} already has a draft or prerelease; review it manually`
    );
    return existing;
  }
  const { data } = await github.rest.repos.createRelease({
    ...repo,
    tag_name: tag,
    target_commitish: sha,
    name: tag,
    generate_release_notes: true,
    draft: false,
    prerelease: false,
  });
  return data;
}
