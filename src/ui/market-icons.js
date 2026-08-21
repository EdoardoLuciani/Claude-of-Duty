import { svg } from './util.js';

/**
 * Stencil silhouettes for the supply-market cards. Same language as the
 * killfeed rifle and the ammo-panel grenade: one fill, geometric, reads at
 * ~40 px. `currentColor` so the card's ink / equipped amber tints them.
 */

function icon(parent, viewBox, draw) {
  const s = svg('svg', {
    viewBox,
    fill: 'currentColor',
    'aria-hidden': 'true',
  }, parent);
  draw(s);
  return s;
}

function p(parent, d) {
  svg('path', { d }, parent);
}
function r(parent, x, y, w, h, rx) {
  const a = { x, y, width: w, height: h };
  if (rx) a.rx = rx;
  svg('rect', a, parent);
}
function poly(parent, points) {
  svg('polygon', { points }, parent);
}

function grenade(parent) {
  return icon(parent, '0 0 20 24', (s) => {
    p(s, 'M8 0h4v2.4h1.8l1.3 2.2H5.9L7.2 2.4H8z');
    p(s, 'M10 5.4c3.6 0 6.5 3.3 6.5 8.1S13.6 24 10 24 3.5 18.3 3.5 13.5 6.4 5.4 10 5.4z');
    const g = svg('g', { fill: 'none', stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.9 }, s);
    svg('line', { x1: 4.4, y1: 11.2, x2: 15.6, y2: 11.2 }, g);
    svg('line', { x1: 4.4, y1: 15.2, x2: 15.6, y2: 15.2 }, g);
    svg('line', { x1: 4.4, y1: 19, x2: 15.6, y2: 19 }, g);
    svg('line', { x1: 10, y1: 6, x2: 10, y2: 23.2 }, g);
  });
}

function armour(parent) {
  return icon(parent, '0 0 22 24', (s) => {
    // HUD plate row, stood on end: three ceramic slabs with a dark well.
    r(s, 3.2, 1.4, 15.6, 6.2, 0.6);
    r(s, 3.2, 8.9, 15.6, 6.2, 0.6);
    r(s, 3.2, 16.4, 15.6, 6.2, 0.6);
    const g = svg('g', { fill: 'rgba(0,0,0,.45)' }, s);
    r(g, 5.4, 3.4, 11.2, 2.2, 0.3);
    r(g, 5.4, 10.9, 11.2, 2.2, 0.3);
    r(g, 5.4, 18.4, 11.2, 2.2, 0.3);
  });
}

function ammo(parent) {
  return icon(parent, '0 0 16 24', (s) => {
    r(s, 4.2, 0.4, 7.6, 4.2, 0.6);
    r(s, 2.4, 4.4, 11.2, 19.2, 1.4);
    svg('rect', { x: 4.6, y: 7.2, width: 6.8, height: 4.2, rx: 0.5, fill: 'rgba(0,0,0,.5)' }, s);
    const g = svg('g', { fill: 'rgba(0,0,0,.4)' }, s);
    for (let i = 0; i < 4; i++) r(g, 4.8, 13.2 + i * 2.1, 6.4, 1.1, 0.4);
  });
}

function smg(parent) {
  return icon(parent, '0 0 64 20', (s) => {
    // Short PDW, left-of-centre so the missing barrel is the read.
    poly(s, '10,8.2 18,8.2 18,12.2 13,12.2');
    r(s, 17.6, 7.2, 12, 5.2);
    r(s, 29.4, 8, 8, 3.4);
    r(s, 37.2, 8.6, 8.4, 2);          // stub barrel
    r(s, 44.8, 7.4, 1.4, 2.4);
    poly(s, '21.2,12.2 26.4,12.2 25.4,19.2 21.6,19.2'); // hanging mag
    poly(s, '28.6,12.2 32,12.2 31,16.6 28.2,16.6');
  });
}

function rifle(parent) {
  return icon(parent, '0 0 64 20', (s) => {
    poly(s, '2,7.6 12.4,7.6 12.4,12.4 5.2,12.4');
    r(s, 12, 6.6, 14.4, 5.6);
    r(s, 26.2, 7.6, 11, 3.6);
    r(s, 37, 8.2, 20.4, 2.2);
    r(s, 55.6, 5.6, 1.6, 3);
    r(s, 22.4, 3.6, 8, 3, 0.4);       // optic
    poly(s, '18.4,12.2 24.2,12.2 23,19.4 18.8,19.4');
    poly(s, '26.4,12.2 30.2,12.2 29,16.8 26,16.8');
  });
}

function shotgun(parent) {
  return icon(parent, '0 0 64 20', (s) => {
    // Pump: no box mag. Tube under the barrel is the tell.
    poly(s, '1,6.8 13,6.8 13,13.2 4,13.2');
    r(s, 12.6, 6.6, 12.4, 6, 0.5);
    r(s, 24.6, 7.4, 10.4, 3.4);       // pump sleeve
    r(s, 25, 11.6, 22, 2);            // mag tube
    r(s, 34.6, 7.6, 26.2, 2.2);       // long barrel
    r(s, 60.2, 5.8, 1.6, 2.4);        // bead
    poly(s, '16.6,12.6 21.4,12.6 20.4,19.2 16.8,19.2');
  });
}

function lmg(parent) {
  return icon(parent, '0 0 64 20', (s) => {
    poly(s, '1.2,6.4 12.2,6.4 12.2,13.4 3.4,13.4');
    r(s, 11.8, 5.2, 16.8, 7.6);       // fat receiver
    r(s, 28.4, 7.2, 9.2, 4);
    r(s, 37.4, 8, 20.6, 2.6);
    r(s, 21.4, 2.2, 8.6, 3.2, 0.3);
    poly(s, '15.2,12.6 26.2,12.6 25.4,19.6 15.6,19.6'); // box mag
    poly(s, '28.2,12.8 32.2,12.8 31.2,17.4 27.8,17.4');
    svg('line', { x1: 42, y1: 10.4, x2: 40.2, y2: 19.2, stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'square' }, s);
    svg('line', { x1: 45.4, y1: 10.4, x2: 47.4, y2: 19.2, stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'square' }, s);
  });
}

function sniper(parent) {
  return icon(parent, '0 0 64 20', (s) => {
    poly(s, '0.4,5.8 13.2,5.8 13.2,9.4 10.4,9.4 10.4,13 3.2,13'); // cheek rest
    r(s, 12.8, 6.6, 12.4, 5.2);
    r(s, 25, 7.8, 8.4, 3);
    r(s, 33.2, 8.2, 24.4, 1.8);       // long barrel
    r(s, 57.4, 7, 5.6, 3.4);          // muzzle brake
    r(s, 18.4, 1.2, 14.2, 5.4, 1.6);  // fat optic
    poly(s, '16.6,11.6 21.6,11.6 20.8,18.8 16.8,18.8');
    poly(s, '24.2,11.6 28,11.6 27,16.4 24,16.4');
  });
}

function carpet(parent) {
  return icon(parent, '0 0 28 20', (s) => {
    // Inverted chevrons over a fuselage — a strike, not another gun.
    p(s, 'M14 1.2 26.4 8.2l-2.2 1.8L14 4.6 3.8 10 1.6 8.2z');
    p(s, 'M14 6.4 24.6 12.4l-2.1 1.7L14 9.6 5.5 14.1 3.4 12.4z');
    p(s, 'M14 11.4 22.4 16.4l-2 1.6-6.4-3.8-6.4 3.8-2-1.6z');
    r(s, 12.6, 16.6, 2.8, 2.8);
  });
}

const DRAW = { grenade, armour, ammo, smg, rifle, shotgun, lmg, sniper, carpet };

export function marketIcon(id, parent) {
  return (DRAW[id] ?? ammo)(parent);
}
