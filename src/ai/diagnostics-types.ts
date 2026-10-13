export {};

declare global {
  interface Window {
    /** Boot callback probe, installed before the engine scripts. */
    __FRAMES__?: [number, number][];
  }
}
