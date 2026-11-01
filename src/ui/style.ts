import { FONT_STACK, FONT_DISPLAY, FONT_MONO } from './util.ts';

/**
 * All HUD styling lives here as one injected stylesheet.
 *
 * Design system
 * -------------
 *  scale     every dimension is `calc(N * var(--k))` where --k is set from the
 *            fitted 1920x1080 reference size. Both viewport axes constrain
 *            this uniform scale, preserving proportions in narrow windows.
 *  spacing   4px grid: --u. Screen margins are 6u (24px @1080p), the same
 *            margin CoD uses (~2.2% of height).
 *  type      one condensed system stack, uppercase, tabular figures, three
 *            ink levels (94% / 58% / 30%) and one accent per semantic:
 *            amber = caution, red = threat, cyan = friendly/objective.
 *  contrast  every text run carries a two-stop shadow (tight dark + wide
 *            dark bloom) so it survives a blown-out sky *and* a black
 *            interior without a scrim behind it.
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
  --sh-hard: 0 1px 1px rgba(0,0,0,.95);

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

.ow-hud .lbl {
  font-size: calc(10.5px * var(--k));
  letter-spacing: .2em;
  color: var(--ink-2);
  text-shadow: var(--sh);
}
.ow-layer { position:absolute; inset:0; }
/* ================================================================== menu */
.ow-menu {
  position:absolute; inset:0; pointer-events:auto;
  display:flex; flex-direction:column; overflow:auto;
  background: linear-gradient(105deg, rgba(4,6,8,.90) 0%, rgba(4,6,8,.72) 46%, rgba(4,6,8,.42) 100%);
  backdrop-filter: blur(calc(9px * var(--k))) saturate(.7) brightness(.8);
  opacity:0; will-change: opacity;
}
.ow-menu-layout {
  display:grid; grid-template-columns: minmax(400px, calc(430px * var(--k))) minmax(0, 1fr);
  gap: max(28px, calc(40px * var(--k)));
  width: min(max(1520px, calc(1520px * var(--k))), 100%);
  padding:24px; margin:auto; flex-shrink:0;
}
.ow-menu-inner {
  align-self:center; min-width:0;
  padding-left: calc(var(--u) * 4.5);
  border-left: calc(2px * var(--k)) solid var(--amber);
}
.ow-menu h1 {
  font-family: var(--fd);
  font-size: calc(46px * var(--k)); font-weight:700; letter-spacing:.3em;
  text-shadow: 0 2px 6px rgba(0,0,0,.8);
}
.ow-menu .sub {
  margin-top: calc(var(--u) * 1.2); font-size: calc(10px * var(--k));
  letter-spacing:.28em; color: var(--ink-3);
}
.ow-menu .rule {
  margin: calc(var(--u) * 5) 0 calc(var(--u) * 2); height:1px;
  background: linear-gradient(to right, rgba(255,255,255,.28), rgba(255,255,255,0));
}
.ow-row {
  display:flex; align-items:center; justify-content:space-between;
  gap: calc(var(--u) * 4); padding: calc(var(--u) * 3.2) 0;
  border-bottom: 1px solid var(--hair-2);
}
.ow-row > .name { font-size: calc(11.5px * var(--k)); letter-spacing:.2em; color: var(--ink); }
.ow-row > .val { font-family: var(--fm); font-size: calc(11px * var(--k)); color: var(--amber);
  letter-spacing:.04em; min-width: calc(46px * var(--k)); text-align:right; }
.ow-seg { display:flex; gap:0; }
.ow-seg button {
  appearance:none; border:1px solid var(--hair); border-right:0; background:rgba(255,255,255,.03);
  color: var(--ink-2); font-family:var(--ff); font-weight:600; text-transform:uppercase;
  font-size: calc(10px * var(--k)); letter-spacing:.16em;
  padding: calc(var(--u) * 1.3) calc(var(--u) * 2.2);
  cursor:pointer; position:relative; transition: color .12s, background .12s;
}
.ow-seg button:last-child { border-right:1px solid var(--hair); }
.ow-seg button:hover { color: var(--ink); background: rgba(255,255,255,.07); }
.ow-seg button.on { color:#0b0d0f; background: var(--ink); }
.ow-slider { position:relative; width: calc(190px * var(--k)); height: calc(18px * var(--k)); }
.ow-slider .track {
  position:absolute; left:0; right:0; top:50%; height: calc(2px * var(--k));
  transform: translateY(-50%); background: rgba(255,255,255,.16);
}
.ow-slider .fill {
  position:absolute; left:0; top:50%; height: calc(2px * var(--k));
  transform: translateY(-50%); background: var(--amber);
}
.ow-slider .knob {
  position:absolute; top:50%; width: calc(9px * var(--k)); height: calc(9px * var(--k));
  background: var(--amber); transform: translate(-50%,-50%) rotate(45deg);
  box-shadow: 0 0 calc(6px * var(--k)) rgba(255,176,42,.5);
}
.ow-slider input {
  position:absolute; inset:0; width:100%; height:100%; margin:0;
  appearance:none; background:transparent; cursor:pointer; opacity:0;
}
.ow-btns { margin-top: calc(var(--u) * 5); display:flex; gap: calc(var(--u) * 2.5); }
.ow-btn {
  appearance:none; border:1px solid var(--hair); background: rgba(255,255,255,.04);
  color: var(--ink); font-family: var(--ff); font-weight:600; text-transform:uppercase;
  font-size: calc(11px * var(--k)); letter-spacing:.2em;
  padding: calc(var(--u) * 2.2) calc(var(--u) * 5);
  cursor:pointer; transition: background .12s, border-color .12s;
}
.ow-btn:hover { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.4); }
.ow-btn.primary { background: var(--amber); border-color: var(--amber); color:#100b02; }
.ow-btn.primary:hover { background:#ffc251; }
.ow-menu .hint {
  margin-top: calc(var(--u) * 4); font-size: calc(9.5px * var(--k));
  letter-spacing:.2em; color: var(--ink-3);
}

/* Pause reference stays in normal flow: short/narrow viewports scroll rather
   than clipping controls or shrinking text below a readable size. */
.ow-menu .ow-row > .name { font-size:max(12px, calc(11.5px * var(--k))); }
.ow-menu .ow-row > .val, .ow-menu .ow-btn { font-size:max(12px, calc(11px * var(--k))); }
.ow-menu .ow-seg button { font-size:max(11px, calc(10px * var(--k))); }
.ow-menu .hint { font-size:max(11px, calc(9.5px * var(--k))); color:#bdcbd3; letter-spacing:.08em; }
.ow-menu :focus-visible { outline:2px solid var(--amber); outline-offset:4px; }
.ow-controls {
  min-width:0; max-height:calc(100vh - 48px); overflow:auto;
  padding:max(18px, calc(24px * var(--k)));
  background:rgba(7,11,15,.94); border:1px solid var(--hair);
  text-transform:none; letter-spacing:.02em;
}
.ow-controls h2 { font-family:var(--fd); font-size:max(24px, calc(28px * var(--k))); letter-spacing:.16em; }
.ow-controls-note { font-size:max(14px, calc(14px * var(--k))); line-height:1.5; color:#bdcbd3; margin-top:12px; }
.ow-controls-groups { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:20px 28px; margin:16px 0; }
.ow-controls h3 { font-size:max(14px, calc(14px * var(--k))); color:var(--amber); margin-bottom:8px; }
.ow-control {
  display:grid; grid-template-columns:minmax(0, .65fr) minmax(0, 1fr); gap:12px;
  padding:6px 0; border-top:1px solid var(--hair-2);
  font-size:max(14px, calc(14px * var(--k))); line-height:1.4;
}
.ow-control dt { color:#f0f5f7; font-weight:800; }
.ow-control dd { color:#bdcbd3; }
.ow-control dt, .ow-control dd { overflow-wrap:anywhere; }

@media (max-width:1200px) {
  .ow-controls-groups { grid-template-columns:minmax(0, 1fr); }
}
@media (max-width:1000px) {
  .ow-menu-layout { grid-template-columns:minmax(0, 1fr); max-width:760px; }
  .ow-menu-inner { width:100%; }
  .ow-controls { max-height:none; }
}
@media (max-width:560px) {
  .ow-menu-layout { padding:16px; }
  .ow-menu .ow-row { flex-wrap:wrap; }
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
.ow-market-inspect-status { min-height:3.2em; padding-top:calc(var(--u) * 2); }
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

/* ============================================================== fadeouts */
.ow-hidden { display:none !important; }

/* ============================================================== radio */
.ow-radio {
  position:absolute; left:50%; bottom:calc(132px * var(--k));
  transform:translateX(-50%);
  will-change: opacity;
}
.ow-radio-panel {
  width:calc(268px * var(--k));
  background:linear-gradient(160deg, rgba(10,15,12,.96) 0%, rgba(5,8,7,.95) 100%);
  border:1px solid var(--hair-2);
  box-shadow:0 0 0 calc(1px * var(--k)) rgba(0,0,0,.5),
             0 calc(14px * var(--k)) calc(38px * var(--k)) rgba(0,0,0,.55);
  padding:calc(var(--u) * 3) calc(var(--u) * 4) calc(var(--u) * 3);
}
.ow-radio-head {
  display:flex; align-items:center; justify-content:space-between;
  margin-bottom:calc(var(--u) * 2.5);
}
.ow-radio-title {
  font-size:calc(10px * var(--k)); letter-spacing:.34em; color:var(--amber);
  text-shadow:var(--sh);
}
.ow-radio-hint {
  font-size:calc(8px * var(--k)); letter-spacing:.18em; color:var(--ink-2);
}
.ow-radio-row {
  display:grid; grid-template-columns:calc(20px * var(--k)) 1fr auto auto;
  align-items:center; gap:calc(var(--u) * 1.6);
  padding:calc(var(--u) * 1.3) 0;
  border-top:1px solid var(--hair-2);
}
.ow-radio-row.locked { grid-template-columns:calc(20px * var(--k)) 1fr auto; }
.ow-radio-key {
  min-width:calc(20px * var(--k)); height:calc(20px * var(--k));
  display:flex; align-items:center; justify-content:center;
  font-size:calc(10px * var(--k));
  border:1px solid rgba(255,255,255,.5); border-radius:calc(2px * var(--k));
  background:rgba(8,11,14,.4); text-shadow:var(--sh-hard);
}
.ow-radio-name {
  font-size:calc(10px * var(--k)); letter-spacing:.16em; color:var(--ink);
  text-shadow:var(--sh-o1); text-align:left;
}
.ow-radio-charge {
  font-size:calc(9px * var(--k)); letter-spacing:.1em; color:var(--ink-2);
  font-family:var(--fm);
}
.ow-radio-secret {
  font-size:calc(7.5px * var(--k)); letter-spacing:.22em; color:rgba(255,120,120,.8);
  text-shadow:var(--sh);
}
.ow-radio-row.ready .ow-radio-name,
.ow-radio-row.ready .ow-radio-charge { color:var(--amber); }
.ow-radio-row.ready .ow-radio-key { border-color:var(--amber); color:var(--amber); }
.ow-radio-row.empty { opacity:.4; }
.ow-radio-row.empty .ow-radio-charge { color:rgba(255,110,110,.85); }
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
