import { GlobalRegistrator } from '@happy-dom/global-registrator';

interface TestDom {
  document: Document;
  Keyboard: typeof KeyboardEvent;
  Mouse: typeof MouseEvent;
  Wheel: typeof WheelEvent;
  Pointer: typeof PointerEvent;
}

async function captureDom(): Promise<TestDom> {
  const symbols = new Map(
    Object.getOwnPropertySymbols(globalThis).map(
      (key): [symbol, PropertyDescriptor | undefined] => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]
    )
  );
  GlobalRegistrator.register();
  try {
    // Keep a separate window alive after the temporary global window is closed.
    return {
      document: new globalThis.Window().document,
      Keyboard: globalThis.KeyboardEvent,
      Mouse: globalThis.MouseEvent,
      Wheel: globalThis.WheelEvent,
      Pointer: globalThis.PointerEvent,
    };
  } finally {
    try {
      await GlobalRegistrator.unregister();
    } finally {
      // The registrator restores string keys but currently leaves symbol keys.
      for (const key of Object.getOwnPropertySymbols(globalThis)) {
        const descriptor = symbols.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  }
}
const { document: nativeDocument, Keyboard, Mouse, Wheel, Pointer } = await captureDom();

export function testDocument(): Document {
  return nativeDocument.implementation.createHTMLDocument();
}
export function testElement<K extends keyof HTMLElementTagNameMap>(
  tag: K
): HTMLElementTagNameMap[K] {
  return nativeDocument.createElement(tag);
}
export function testStyle(): CSSStyleDeclaration {
  return testElement('div').style;
}
export function testClasses(): DOMTokenList {
  return testElement('div').classList;
}
export function testKeyboardEvent(): KeyboardEvent {
  return new Keyboard('keydown');
}
export function testMouseEvent(): MouseEvent {
  return new Mouse('mousedown');
}
export function testWheelEvent(): WheelEvent {
  return new Wheel('wheel');
}
export function testPointerEvent(): PointerEvent {
  return new Pointer('click');
}
