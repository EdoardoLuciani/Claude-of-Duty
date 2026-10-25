import 'vite/types/hot.js';

// Vite's HMR client awaits disposers in fetchUpdate() and prunePaths(). Its
// shipped callback declaration only mentions void, unlike that runtime contract.
declare module 'vite/types/hot.js' {
  interface ViteHotContext {
    dispose(callback: (data: ViteHotContext['data']) => void | Promise<void>): void;
  }
}
