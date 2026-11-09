import assert from 'node:assert/strict';

const original = new Map(
  Reflect.ownKeys(globalThis).map((key): [PropertyKey, PropertyDescriptor | undefined] => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
);
const { testDocument, testElement, testKeyboardEvent } = await import('../lib/dom-fixture.ts');
assert.deepEqual(new Set(Reflect.ownKeys(globalThis)), new Set(original.keys()));
for (const [key, descriptor] of original)
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), descriptor);

const document = testDocument();
const parent = document.createElement('div');
const button = document.createElement('button');
parent.append(button);
button.textContent = 'START';
button.classList.add('ready');
button.style.setProperty('width', '100px');
assert.equal(parent.children.item(0), button);
assert.equal(button.ownerDocument, document);
assert.equal(button.textContent, 'START');
assert.equal(button.classList.contains('ready'), true);
assert.equal(button.style.width, '100px');
let keys = 0;
button.addEventListener('keydown', (): void => {
  keys++;
});
button.dispatchEvent(testKeyboardEvent());
assert.equal(keys, 1);
assert.equal(testElement('canvas').getContext('webgpu'), null);
console.log('DOM fixtures: complete native contracts without global string or symbol leaks');
