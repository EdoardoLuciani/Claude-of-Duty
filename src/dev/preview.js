/**
 * DEV ONLY — single entry for every standalone subsystem preview.
 *
 *   /src/dev/preview.html?view=materials|fx|weapons|ai
 *
 * The legacy per-subsystem URLs still work; the view is derived from the path:
 *   /src/materials/preview.html   /src/fx/preview.html
 *   /src/weapons/preview.html     /src/ai/preview.html
 *
 * Only the requested preview module is loaded (dynamic import), so a subsystem
 * mid-edit cannot break the other previews — the reason these pages exist is
 * that the main game boot may be broken while iterating.
 */
const VIEWS = {
  materials: () => import('../materials/preview.js'),
  fx: () => import('../fx/preview.js'),
  weapons: () => import('../weapons/preview.js'),
  ai: () => import('../ai/preview.js'),
};

/** Which canvas each view draws into (all four pages carry both). */
const CANVAS = { materials: 'c', fx: 'fx', weapons: 'c', ai: 'c' };

const params = new URLSearchParams(location.search);
// Legacy pages carry subsystem-internal `?view=` params (e.g. weapons' view=hero),
// so the preview kind must come from the PATH on those pages; only the
// universal page (src/dev/preview.html) selects via ?view=.
const fromPath = (location.pathname.match(/\/([^/]+)\/preview\.html$/) ?? [])[1];
const view = VIEWS[fromPath] ? fromPath : (params.get('view') ?? fromPath);

const load = VIEWS[view];
if (!load) {
  for (const id of ['c', 'fx']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  document.body.innerHTML =
    `<pre style="color:#f66;font:14px ui-monospace,monospace;padding:2rem">` +
    `unknown preview view "${view}" — use ?view=${Object.keys(VIEWS).join('|')}</pre>`;
  throw new Error(`unknown preview view: ${view}`);
}

// Only the view's canvas is visible (the universal page carries both ids).
for (const id of ['c', 'fx']) {
  const el = document.getElementById(id);
  if (el) el.style.display = id === CANVAS[view] ? 'block' : 'none';
}

await load();
