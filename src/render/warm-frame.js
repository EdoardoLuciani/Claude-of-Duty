/** Wait for a real native animation frame, never simulate Three's frame clock.
 * Hidden tabs resume on visibility; a stalled/hidden boot fails after the graph
 * deadline rather than hanging forever. Cancel the callback before rejecting. */
export function warmFrame(draw, signal, deadline) {
  return new Promise((resolve, reject) => {
    let raf, timer;
    const finish = error => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason);
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', abort, { once: true });
    const timeout = () => finish(new Error('Native warmup timed out; keep this tab visible and reload'));
    const remaining = deadline - performance.now();
    if (remaining <= 0) { timeout(); return; }
    timer = setTimeout(timeout, remaining);
    raf = requestAnimationFrame(() => {
      if (performance.now() >= deadline) { timeout(); return; }
      try {
        draw();
        if (performance.now() >= deadline) timeout(); else finish();
      } catch (error) { finish(error); }
    });
  });
}
