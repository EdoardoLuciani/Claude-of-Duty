// Diagnostic snapshots only; never reset renderer.info to obtain convenient counts.
export function rendererCounters(renderer) {
  const info = renderer?.info, native = renderer?.backend?.isWebGPUBackend === true;
  return {
    rendererFrame: native ? info?.frame ?? null : null,
    renderCallsTotal: native ? info?.render?.calls ?? null : null,
    renderCallsFrame: native ? info?.render?.frameCalls ?? null : null,
    drawCallsFrame: info?.render?.drawCalls ?? (native ? null : info?.render?.calls ?? null),
    computeCallsTotal: native ? info?.compute?.calls ?? null : null,
    computeCallsFrame: native ? info?.compute?.frameCalls ?? null : null,
    shaderStagesLive: native ? info?.memory?.programs ?? null : null,
    webglProgramsLive: native ? null : info?.programs?.length ?? null,
  };
}
