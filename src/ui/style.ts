import { FONT_STACK, FONT_DISPLAY, FONT_MONO } from './util.ts';

/** Injected native-menu/overlay stylesheet; gameplay HUD presentation is Pixi-owned.
 * --k uniformly fits the 1920x1080 reference in both viewport axes; --u is a 4 px grid.
 * Condensed/tabular type, semantic accents and tight+wide shadows preserve scene contrast.
 */

const CSS = `
.ow-hud, .ow-hud * { margin:0; padding:0; box-sizing:border-box; }

.ow-hud {
  --k: 1;
  --u: calc(4px * var(--k));
  --pad: calc(var(--u) * 6.5);

  --ink:   rgba(238,244,247,.95);
  --ink-2: rgba(214,227,234,.60);
  --ink-3: rgba(196,210,219,.30);
  --hair:  rgba(255,255,255,.15);
  --hair-2:rgba(255,255,255,.07);

  --amber: #ffb02a;
  --red:   #ff3f31;
  --blood: #8d0f0a;
  --cyan:  #79d2ff;
  --friend:#8fc8ff;
  --enemy: #ff7a63;
  --ok:    #a8e86a;

  --sh: 0 1px 2px rgba(0,0,0,.92), 0 0 calc(10px * var(--k)) rgba(0,0,0,.45);

  /* Symmetric synthesized outlines. An offset drop-shadow is a web-overlay
     tell and it fights whatever direction the scene key light comes from; a
     ring of eight equal-radius hard shadows reads as a drawn outline and is
     direction-free. Each is paired with one tight soft shadow for the seat. */
  --oc: #080c10;
  --o1:
    calc(1.5px * var(--k)) 0 0 var(--oc), calc(-1.5px * var(--k)) 0 0 var(--oc),
    0 calc(1.5px * var(--k)) 0 var(--oc), 0 calc(-1.5px * var(--k)) 0 var(--oc),
    calc(1.1px * var(--k)) calc(1.1px * var(--k)) 0 var(--oc),
    calc(-1.1px * var(--k)) calc(1.1px * var(--k)) 0 var(--oc),
    calc(1.1px * var(--k)) calc(-1.1px * var(--k)) 0 var(--oc),
    calc(-1.1px * var(--k)) calc(-1.1px * var(--k)) 0 var(--oc);
  --o2:
    calc(2px * var(--k)) 0 0 var(--oc), calc(-2px * var(--k)) 0 0 var(--oc),
    0 calc(2px * var(--k)) 0 var(--oc), 0 calc(-2px * var(--k)) 0 var(--oc),
    calc(1.45px * var(--k)) calc(1.45px * var(--k)) 0 var(--oc),
    calc(-1.45px * var(--k)) calc(1.45px * var(--k)) 0 var(--oc),
    calc(1.45px * var(--k)) calc(-1.45px * var(--k)) 0 var(--oc),
    calc(-1.45px * var(--k)) calc(-1.45px * var(--k)) 0 var(--oc);
  /* outline + tight soft seat, no directional offset */
  --sh-o1: var(--o1), 0 0 calc(4px * var(--k)) rgba(3,6,9,.8);
  --sh-o2: var(--o2), 0 0 calc(5px * var(--k)) rgba(3,6,9,.85);

  --ff: ${FONT_STACK};
  --fd: ${FONT_DISPLAY};
  --fm: ${FONT_MONO};

  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 10;
  font-family: var(--ff);
  font-weight: 600;
  color: var(--ink);
  letter-spacing: .06em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
  -webkit-font-smoothing: antialiased;
  text-transform: uppercase;
  overflow: hidden;
  contain: layout style;
  user-select: none;
}


.ow-layer { position:absolute; inset:0; }
/* Native modal overlays: drop UA dialog chrome; each overlay draws its own scrim. */
.ow-dialog {
  border:0; color:inherit; /* .ow-hud * already resets margin/padding. */
  width:auto; height:auto; max-width:none; max-height:none;
}
.ow-dialog::backdrop { background:transparent; }
/* ================================================================== menu */
.ow-menu {
  position:absolute; inset:0; pointer-events:auto;
  display:flex; flex-direction:column; overflow:auto;
  background: linear-gradient(105deg, rgba(4,6,8,.92) 0%, rgba(4,6,8,.78) 46%, rgba(4,6,8,.55) 100%);
  backdrop-filter: blur(calc(9px * var(--k))) saturate(.7) brightness(.8);
  opacity:0; will-change: opacity;
}
/* Rail (title, tabs, Resume) beside one fixed-height page; short viewports scroll. */
.ow-menu-layout {
  display:grid; grid-template-columns: minmax(240px, calc(300px * var(--k))) minmax(0, calc(900px * var(--k)));
  gap: max(28px, calc(48px * var(--k)));
  width:100%; max-width: max(1100px, calc(1300px * var(--k)));
  padding:24px; margin:auto; flex-shrink:0;
}
.ow-menu-rail {
  display:flex; flex-direction:column; align-self:center;
  --rail-pad: calc(var(--u) * 4.5); --rail-line: calc(2px * var(--k));
  padding-left: var(--rail-pad);
  border-left: var(--rail-line) solid var(--amber);
}
.ow-menu h1 {
  font-family: var(--fd);
  font-size: max(36px, calc(46px * var(--k))); font-weight:700; letter-spacing:.3em;
  text-shadow: 0 2px 6px rgba(0,0,0,.8);
}
.ow-menu .sub {
  margin-top: calc(var(--u) * 1.2); font-size: max(10px, calc(10px * var(--k)));
  letter-spacing:.16em; white-space:nowrap; color: var(--ink-3);
}
.ow-tabs { display:flex; flex-direction:column; margin: calc(var(--u) * 8) 0; }
.ow-tab {
  appearance:none; border:0; background:transparent; text-align:left; cursor:pointer;
  font-family:var(--fd); font-weight:700; text-transform:uppercase;
  font-size:max(18px, calc(22px * var(--k))); letter-spacing:.18em; color: var(--ink-2);
  padding: calc(var(--u) * 2.2) calc(var(--u) * 3);
  /* The selected tab's marker sits on the rail line. */
  margin-left: calc(-1 * (var(--rail-pad) + var(--rail-line)));
  border-left: var(--rail-line) solid transparent;
  transition: color .12s, background .12s, border-color .12s;
}
.ow-tab:hover { color: var(--ink); background: rgba(255,255,255,.05); }
.ow-tab.on {
  color: var(--ink); border-left-color: var(--ink);
  background: linear-gradient(to right, rgba(255,176,42,.18), rgba(255,176,42,0));
}
.ow-menu-rail .ow-btn.primary { align-self:flex-start; }
.ow-menu-pages {
  min-width:0; height: min(calc(840px * var(--k)), calc(100vh - 48px)); min-height:420px;
  background:rgba(7,11,15,.94); border:1px solid var(--hair);
}
.ow-page { height:100%; overflow:auto; padding: max(20px, calc(28px * var(--k))) max(22px, calc(32px * var(--k))); }
.ow-page-head {
  display:flex; align-items:center; justify-content:space-between; gap:16px;
  padding-bottom: calc(var(--u) * 3); margin-bottom: calc(var(--u) * 1);
  border-bottom: 1px solid var(--hair);
}
.ow-page-head h2 { font-family:var(--fd); font-size:max(24px, calc(28px * var(--k))); letter-spacing:.16em; }
.ow-page-note {
  font-size:max(14px, calc(14px * var(--k))); line-height:1.5; color:#bdcbd3;
  text-transform:none; letter-spacing:.02em; margin: calc(var(--u) * 3) 0 calc(var(--u) * 1);
}
.ow-row {
  display:flex; align-items:center; justify-content:space-between;
  gap: calc(var(--u) * 4); padding: calc(var(--u) * 2.6) 0;
  border-bottom: 1px solid var(--hair-2);
}
.ow-row > .name {
  flex:1 1 auto; min-width:0; letter-spacing:.2em; color: var(--ink);
  font-size:max(13px, calc(13px * var(--k)));
}
.ow-row > .name .detail {
  margin-top:4px; font-size:max(13px, calc(13px * var(--k)));
  letter-spacing:.02em; text-transform:none; color:#bdcbd3;
}
.ow-row > .val {
  font-family: var(--fm); font-size:max(13px, calc(12px * var(--k))); color: var(--amber);
  letter-spacing:.04em; min-width: max(56px, calc(56px * var(--k))); text-align:right;
}
.ow-seg { display:flex; gap:0; flex:none; }
.ow-seg button {
  appearance:none; border:1px solid var(--hair); border-right:0; background:rgba(255,255,255,.03);
  color: var(--ink-2); font-family:var(--ff); font-weight:600; text-transform:uppercase;
  font-size:max(11px, calc(11px * var(--k))); letter-spacing:.16em;
  padding: calc(var(--u) * 1.5) calc(var(--u) * 2.6);
  cursor:pointer; position:relative; transition: color .12s, background .12s;
}
.ow-seg button:last-child { border-right:1px solid var(--hair); }
.ow-seg button:hover { color: var(--ink); background: rgba(255,255,255,.07); }
.ow-seg button.on { color:#0b0d0f; background: var(--ink); }
.ow-slider { position:relative; flex:none; width: max(160px, calc(260px * var(--k))); height: max(16px, calc(18px * var(--k))); }
.ow-slider .track {
  position:absolute; left:0; right:0; top:50%; height: calc(2px * var(--k));
  transform: translateY(-50%); background: rgba(255,255,255,.16);
}
.ow-slider .fill {
  position:absolute; left:0; top:50%; height: calc(2px * var(--k));
  transform: translateY(-50%); background: var(--amber);
}
.ow-slider .knob {
  position:absolute; top:50%; width: calc(10px * var(--k)); height: calc(10px * var(--k));
  background: var(--amber); transform: translate(-50%,-50%) rotate(45deg);
  box-shadow: 0 0 calc(6px * var(--k)) rgba(255,176,42,.5);
}
.ow-slider input {
  position:absolute; inset:0; width:100%; height:100%; margin:0;
  appearance:none; background:transparent; cursor:pointer; opacity:0;
}
.ow-btn {
  appearance:none; border:1px solid var(--hair); background: rgba(255,255,255,.04);
  color: var(--ink); font-family: var(--ff); font-weight:600; text-transform:uppercase;
  font-size:max(12px, calc(11px * var(--k))); letter-spacing:.2em;
  padding: calc(var(--u) * 2.2) calc(var(--u) * 6);
  cursor:pointer; transition: background .12s, border-color .12s;
}
.ow-btn:hover { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.4); }
.ow-btn.primary { background: var(--amber); border-color: var(--amber); color:#100b02; }
.ow-btn.primary:hover { background:#ffc251; }
.ow-btn.small { padding: calc(var(--u) * 1.3) calc(var(--u) * 2.8); }
.ow-menu .hint {
  margin-top: calc(var(--u) * 3); font-size:max(11px, calc(9.5px * var(--k)));
  letter-spacing:.08em; color:#bdcbd3;
}
.ow-menu :focus-visible { outline:2px solid var(--amber); outline-offset:4px; }
.ow-menu .ow-tab:focus-visible { outline-offset:-2px; }
.ow-menu .ow-page:focus-visible { outline-offset:-4px; }
.ow-menu .ow-slider:has(input:focus-visible) { outline:2px solid var(--amber); outline-offset:6px; }
.ow-controls-groups {
  display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:20px 28px; margin:16px 0;
  text-transform:none; letter-spacing:.02em;
}
.ow-controls-groups h3 { font-size:max(14px, calc(14px * var(--k))); color:var(--amber); margin-bottom:8px; }
.ow-control {
  display:grid; grid-template-columns:minmax(0, .65fr) minmax(0, 1fr); gap:12px;
  padding:6px 0; border-top:1px solid var(--hair-2);
  font-size:max(14px, calc(14px * var(--k))); line-height:1.4;
}
.ow-control dt { color:#f0f5f7; font-weight:800; }
.ow-control dd { color:#bdcbd3; }
.ow-control dt, .ow-control dd { overflow-wrap:anywhere; }

@media (max-width:1100px) {
  .ow-controls-groups { grid-template-columns:minmax(0, 1fr); }
}
@media (max-width:800px) {
  .ow-menu-layout { grid-template-columns:minmax(0, 1fr); }
  .ow-tabs { margin: 16px 0; }
  .ow-menu-pages { height:auto; min-height:0; }
}
@media (max-width:560px) {
  .ow-menu-layout { padding:16px; }
  .ow-row { flex-wrap:wrap; }
  .ow-slider { width:100%; }
}

/* ============================================================= game over */
.ow-gameover {
  position:absolute; inset:0; z-index:20; pointer-events:none;
  display:flex; align-items:center; justify-content:center;
  background:
    radial-gradient(circle at 50% 44%, rgba(8,10,12,.18) 0%, rgba(3,4,5,.76) 72%),
    linear-gradient(to bottom, rgba(0,0,0,.12), rgba(0,0,0,.68));
  backdrop-filter: blur(calc(2px * var(--k))) saturate(.62);
  opacity:0; will-change:opacity,transform;
}
.ow-gameover-panel { width:calc(560px * var(--k)); text-align:center; }
.ow-gameover-eyebrow {
  font-size:calc(10px * var(--k)); letter-spacing:.52em; color:var(--red);
  text-shadow:var(--sh-o1); margin-bottom:calc(var(--u) * 3);
}
.ow-gameover-title {
  font-family:var(--fd); font-size:calc(54px * var(--k)); font-weight:700;
  letter-spacing:.16em; line-height:1; text-shadow:var(--sh-o2);
}
.ow-gameover-rule {
  width:calc(260px * var(--k)); height:1px; margin:calc(var(--u) * 5) auto calc(var(--u) * 3);
  background:linear-gradient(to right, transparent, rgba(255,63,49,.8), transparent);
}
.ow-gameover-sub {
  font-size:calc(10px * var(--k)); letter-spacing:.3em; color:var(--ink-2);
  margin-bottom:calc(var(--u) * 7); text-shadow:var(--sh);
}
.ow-gameover-button {
  appearance:none; min-width:calc(220px * var(--k));
  border:1px solid var(--amber); background:var(--amber); color:#100b02;
  font-family:var(--ff); font-weight:800; text-transform:uppercase;
  font-size:calc(12px * var(--k)); letter-spacing:.28em;
  padding:calc(var(--u) * 3.2) calc(var(--u) * 8);
  cursor:pointer; box-shadow:0 0 calc(24px * var(--k)) rgba(255,176,42,.12);
}
.ow-gameover-button:hover, .ow-gameover-button:focus-visible {
  background:#ffc251; outline:1px solid rgba(255,255,255,.65); outline-offset:calc(3px * var(--k));
}
.ow-gameover-hint {
  margin-top:calc(var(--u) * 3); font-size:calc(9px * var(--k));
  letter-spacing:.24em; color:var(--ink-3); text-shadow:var(--sh);
}

/* ============================================================== market */
.ow-market {
  position:absolute; inset:0; z-index:18; pointer-events:none;
  display:flex; align-items:center; justify-content:center;
  background: radial-gradient(circle at 50% 42%, rgba(6,8,10,.42) 0%, rgba(2,3,5,.78) 100%);
  backdrop-filter: blur(calc(3px * var(--k))) saturate(.8) brightness(.72);
  opacity:0; will-change:opacity;
}
.ow-market-panel {
  width:calc(1240px * var(--k)); max-width:94%; max-height:94%; overflow:hidden;
  display:flex; flex-direction:column;
  background: linear-gradient(160deg, rgba(10,13,16,.96) 0%, rgba(6,8,11,.94) 100%);
  border:1px solid var(--hair-2);
  box-shadow: 0 0 0 calc(1px * var(--k)) rgba(0,0,0,.55), 0 calc(18px * var(--k)) calc(50px * var(--k)) rgba(0,0,0,.6);
  padding: calc(var(--u) * 5) calc(var(--u) * 5.5) calc(var(--u) * 4.5);
}
.ow-market-body { min-height:0; overflow:auto; display:grid; grid-template-columns:minmax(0, 1.6fr) minmax(280px, 1fr); gap:calc(var(--u) * 4); align-items:start; }
.ow-market-catalog { min-width:0; }
.ow-market-inspection { position:sticky; top:0; padding:calc(var(--u) * 3); border:1px solid var(--hair-2); background:rgba(255,255,255,.025); }
.ow-market-inspect-title { font:700 calc(18px * var(--k)) var(--fd); color:var(--ink); margin:calc(var(--u) * 2) 0; letter-spacing:.08em; }
.ow-market-inspect-view { height:calc(320px * var(--k)); background:#10151b; }
.ow-market-inspect-canvas { display:block; width:100%; height:100%; touch-action:none; cursor:grab; }
.ow-market-inspect-canvas:active { cursor:grabbing; }
.ow-market-inspect-art { display:block; width:100%; height:100%; object-fit:contain; background:#171a19; }
.ow-market-inspect-canvas[hidden], .ow-market-inspect-art[hidden], .ow-market-inspect-3d[hidden] { display:none; }
.ow-market-inspect-status, .ow-market-inspect-help { font-size:calc(10px * var(--k)); color:var(--ink-2); line-height:1.6; }
.ow-market-inspect-status { min-height:1.6em; padding-top:calc(var(--u) * 2); }
.ow-market-inspection:has(.ow-market-build:not([hidden])) .ow-market-inspect-view { height:calc(220px * var(--k)); }
.ow-market-build { border-top:1px solid var(--hair-2); margin-top:calc(var(--u) * 2); padding-top:calc(var(--u) * 2); }
.ow-market-build[hidden] { display:none; }
.ow-market-build h3 { margin:0 0 calc(var(--u) * 2); }
.ow-market-build-slot { display:grid; grid-template-columns:5.5em minmax(0, 1fr) 3em; align-items:center; gap:calc(var(--u) * 1.5); margin:calc(var(--u) * 1.5) 0; font-size:calc(10px * var(--k)); color:var(--ink-2); }
.ow-market-build select { min-width:0; width:100%; color:var(--ink); background:#171c21; border:1px solid var(--hair-2); padding:calc(var(--u) * 1.5); font:inherit; color-scheme:dark; }
.ow-market-build-cost { text-align:right; font-family:var(--fm); }
.ow-market-build-base { font-size:calc(10px * var(--k)); color:var(--ink-2); }
.ow-market-stats { width:100%; border-collapse:collapse; margin:calc(var(--u) * 2) 0; font-size:max(13px, calc(10px * var(--k))); color:var(--ink); }
.ow-market-stats caption { text-align:left; color:var(--ink-2); padding-bottom:calc(var(--u) * 1); }
.ow-market-stats th, .ow-market-stats td { padding:calc(var(--u) * .75) calc(var(--u) * 1); text-align:right; font-weight:400; border-bottom:1px solid var(--hair-2); }
.ow-market-stats thead th { color:var(--ink-2); }
.ow-market-stats th:first-child { text-align:left; color:var(--ink-2); }
.ow-market-stats tbody th { cursor:help; }
.ow-market-stats td { font-family:var(--fm); }
.ow-market-stats td:last-child { color:var(--amber); }
.ow-market-stat-delta { display:block; font-size:max(12px, calc(9px * var(--k))); }
.ow-market-stat-delta.better { color:var(--ok); }
.ow-market-stat-delta.worse { color:var(--enemy); }
.ow-market-build-warning { color:var(--amber); font-size:calc(10px * var(--k)); line-height:1.5; }
.ow-market-build-total { display:flex; justify-content:space-between; gap:calc(var(--u) * 2); margin-top:calc(var(--u) * 2); padding-top:calc(var(--u) * 2); border-top:1px solid var(--hair-2); font-size:calc(12px * var(--k)); color:var(--amber); }
.ow-market-build-actions { display:flex; gap:calc(var(--u) * 2); }
.ow-market-build-actions button { flex:1; margin:0; }
.ow-market-build-cancel { color:var(--ink-2); background:transparent; border:1px solid var(--hair-2); font:inherit; font-size:calc(10px * var(--k)); cursor:pointer; }
.ow-market-build select:focus-visible, .ow-market-build-actions button:focus-visible { outline:2px solid var(--amber); outline-offset:3px; }
.ow-market-inspect-tools { display:flex; flex-wrap:wrap; gap:calc(var(--u) * 1); }
.ow-market-inspect-tools button { border:1px solid var(--hair-2); padding:calc(var(--u) * 1.5); color:var(--ink); background:rgba(255,255,255,.04); cursor:pointer; font:inherit; font-size:calc(9px * var(--k)); }
.ow-market-card.inspecting { box-shadow:inset 0 0 0 1px var(--amber); }
.ow-market-card:focus-visible, .ow-market-inspect-canvas:focus-visible, .ow-market-inspect-tools button:focus-visible { outline:2px solid var(--amber); outline-offset:3px; }
@media (max-width:700px) {
  .ow-market-body { grid-template-columns:1fr; }
  .ow-market-inspection { position:static; }
}
.ow-market-head { flex-shrink:0; text-align:center; margin-bottom: calc(var(--u) * 3.5); }
.ow-market-wave {
  font-size:calc(9px * var(--k)); letter-spacing:.4em; color:var(--amber);
  text-shadow:var(--sh); margin-bottom:calc(var(--u) * 1.6);
}
.ow-market-title {
  font-family:var(--fd); font-size:calc(28px * var(--k)); font-weight:700; letter-spacing:.24em;
  color:var(--ink); text-shadow:var(--sh-o2); line-height:1.05;
}
.ow-market-title:focus { outline:none; } /* Neutral initial focus, not a control. */
.ow-market-cred {
  margin-top:calc(var(--u) * 2.4); display:flex; flex-direction:column; align-items:center; gap:calc(var(--u) * .4);
}
.ow-market-cred b {
  font-family:var(--fd); font-size:calc(28px * var(--k)); font-weight:700; font-style:normal;
  letter-spacing:.08em; color:var(--amber); line-height:1;
  text-shadow: var(--o2), 0 0 calc(16px * var(--k)) rgba(255,176,42,.18);
}
.ow-market-cred i {
  font-style:normal; font-size:calc(9px * var(--k)); letter-spacing:.38em; color:var(--ink-2);
  text-shadow:var(--sh);
}
.ow-market-sec { margin-top: calc(var(--u) * 2.5); }
.ow-market-sec-h {
  display:flex; align-items:center; gap:calc(var(--u) * 2);
  margin-bottom: calc(var(--u) * 1.6);
}
.ow-market-sec-n {
  font-family:var(--fm); font-size:calc(9px * var(--k)); letter-spacing:.14em; color:var(--ink-3);
}
.ow-market-sec-l {
  font-size:calc(9.5px * var(--k)); letter-spacing:.32em; color:var(--ink-2); text-shadow:var(--sh);
}
.ow-market-sec-rule {
  flex:1; height:1px; background:linear-gradient(to right, var(--hair), transparent);
}
.ow-market-grid { display:grid; gap:calc(var(--u) * 1.6); grid-template-columns: repeat(3, 1fr); }
.ow-market-card {
  position:relative; display:flex; flex-direction:column; align-items:stretch;
  gap: calc(var(--u) * 0.7);
  padding: calc(var(--u) * 2) calc(var(--u) * 2) calc(var(--u) * 1.8);
  border:1px solid var(--hair-2); background: rgba(255,255,255,.025);
  cursor:pointer;
}
.ow-market-card:hover {
  border-color: rgba(255,176,42,.55); background: rgba(255,176,42,.06);
}
.ow-market-card.on {
  border-color: rgba(255,176,42,.7); color: var(--amber);
  background: rgba(255,176,42,.08);
}
.ow-market-card.capped { opacity:.72; }
.ow-market-card.broke { opacity:.55; }
.ow-market-icon {
  height: calc(32px * var(--k)); margin: calc(var(--u) * 1.4) 0 calc(var(--u) * .5);
  display:flex; align-items:center; justify-content:center;
  color: var(--ink);
}
.ow-market-icon svg { width: calc(56px * var(--k)); height: calc(24px * var(--k)); display:block; }
.ow-market-card.on .ow-market-icon { color: var(--amber); }
.ow-market-name {
  font-size:calc(11px * var(--k)); letter-spacing:.06em; color:var(--ink);
  text-shadow:var(--sh); text-align:center; line-height:1.15;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.ow-market-blurb {
  font-size:calc(8px * var(--k)); letter-spacing:.1em; color:var(--ink-3);
  text-align:center; text-shadow:var(--sh);
}
.ow-market-meta {
  display:flex; align-items:flex-end; justify-content:space-between;
  gap: calc(var(--u) * 1); margin-top: calc(var(--u) * .4);
}
.ow-market-stock { display:flex; flex-direction:column; gap:calc(var(--u) * .5); min-width:0; }
.ow-market-pips { display:flex; gap:calc(3px * var(--k)); }
.ow-market-pips i {
  width:calc(8px * var(--k)); height:calc(8px * var(--k));
  background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1px rgba(0,0,0,.4);
}
.ow-market-pips i.on { background: var(--amber); }
.ow-market-bar {
  width:calc(44px * var(--k)); height:calc(3px * var(--k));
  background: rgba(255,255,255,.14); overflow:hidden;
}
.ow-market-bar i {
  display:block; height:100%; width:100%; background:var(--amber); transform-origin:left; transform:scaleX(0);
}
.ow-market-count {
  font-family:var(--fm); font-size:calc(9px * var(--k)); color:var(--ink-2); letter-spacing:.06em;
}
.ow-market-cost {
  font-family:var(--fm); font-size:calc(11px * var(--k)); color:var(--ink-2);
  letter-spacing:.06em;
}
.ow-market-card.on .ow-market-cost { color: var(--amber); }
.ow-market-buy {
  appearance:none; margin-top: calc(var(--u) * .8);
  border:1px solid var(--amber); background:rgba(255,176,42,.08);
  color:var(--amber); font-family:var(--ff); font-weight:800; text-transform:uppercase;
  font-size:calc(9.5px * var(--k)); letter-spacing:.2em;
  padding:calc(var(--u) * 1.4) calc(var(--u) * 2); cursor:pointer;
  pointer-events:auto;
}
.ow-market-card:hover .ow-market-buy:not(:disabled) { background:var(--amber); color:#100b02; }
.ow-market-buy:disabled { opacity:.35; filter:grayscale(.7); }
.ow-market-foot { flex-shrink:0; display:flex; flex-direction:column; align-items:center; }
.ow-market-skip {
  appearance:none; margin-top:calc(var(--u) * 4); min-width:calc(180px * var(--k));
  border:1px solid var(--hair); background:rgba(255,255,255,.04);
  color:var(--ink); font-family:var(--ff); font-weight:700; text-transform:uppercase;
  font-size:calc(11px * var(--k)); letter-spacing:.28em;
  padding:calc(var(--u) * 2.2) calc(var(--u) * 5); cursor:pointer;
}
.ow-market-skip:hover { background:rgba(255,255,255,.1); border-color:rgba(255,255,255,.4); }
.ow-market-hint {
  margin-top:calc(var(--u) * 2.4); font-size:calc(9px * var(--k));
  letter-spacing:.22em; color:var(--ink-3); text-shadow:var(--sh);
}

`;

let installed = false;

export function installStyles(): void {
  if (installed && document.getElementById('ow-ui-style')) return;
  const s = document.createElement('style');
  s.id = 'ow-ui-style';
  s.textContent = CSS;
  document.head.appendChild(s);
  installed = true;
}

export function removeStyles(): void {
  document.getElementById('ow-ui-style')?.remove();
  installed = false;
}
