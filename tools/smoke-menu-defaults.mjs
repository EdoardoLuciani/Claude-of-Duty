/**
 * Defaults on the current quality preset must refresh Invert Look.
 *
 *   node tools/smoke-menu-defaults.mjs
 */
import { PauseMenu } from '../src/ui/menu.js';

function makeEl(tag = 'div') {
  const classes = new Set();
  return {
    tagName: String(tag).toUpperCase(),
    className: '',
    textContent: '',
    type: '',
    value: '0',
    style: { setProperty() {} },
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    children: [],
    _on: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, fn) {
      (this._on[type] ??= []).push(fn);
    },
    click() {
      for (const fn of this._on.click ?? []) fn();
    },
  };
}

globalThis.document = {
  createElement: (tag) => makeEl(tag),
  exitPointerLock() {},
};

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const menu = new PauseMenu(makeEl(), {
  config: { quality: 'high', invertY: false, sensitivity: 0.0022, fov: 80 },
  events: { emit() {} },
  camera: { fov: 80, updateProjectionMatrix() {} },
  time: { scale: 1 },
  peek: () => null,
});

const [onBtn] = menu.invBtns.find(([, value]) => value);
const [offBtn] = menu.invBtns.find(([, value]) => !value);
onBtn.click();
check('invert turns on', menu.ctx.config.invertY === true && onBtn.classList.contains('on'));

menu.ctx.config.invertY = false;
menu.setQuality('high');
check('defaults-on-high paints invert off', offBtn.classList.contains('on') && !onBtn.classList.contains('on'));

if (failures) process.exit(1);
console.log('smoke-menu-defaults: ok');
