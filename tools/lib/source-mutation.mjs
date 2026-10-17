import assert from 'node:assert/strict';

/** Source controls tolerate formatting, never a missing regression marker. */
export function mutateSource(source, before, after) {
  const pattern =
    before instanceof RegExp
      ? before
      : new RegExp(
          before
            .trim()
            .split(/\s+/)
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('\\s+'),
          'g'
        );
  assert.ok(source.match(pattern), `negative control must match current source: ${before}`);
  const result = source.replace(pattern, after);
  assert.notEqual(result, source, 'negative control must alter source');
  return result;
}

export async function routeSourceMutation(page, file, before, after, transform = (body) => body) {
  await page.route(`**/${file}*`, async (route) => {
    const response = await route.fetch();
    const body = transform(mutateSource(await response.text(), before, after));
    await route.fulfill({ response, body });
  });
}
