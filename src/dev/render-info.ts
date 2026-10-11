// Diagnostic snapshots only; never reset renderer.info to obtain convenient counts.
interface RendererCountersSource {
  backend?: { isWebGPUBackend?: boolean };
  info?: {
    frame?: number;
    render?: { calls?: number; frameCalls?: number; drawCalls?: number };
    compute?: { calls?: number; frameCalls?: number };
    memory?: { programs?: number };
    programs?: unknown[];
  };
}

export function rendererCounters(renderer: object | null | undefined) {
  const source = renderer as RendererCountersSource | null | undefined;
  const info = source?.info, native = source?.backend?.isWebGPUBackend === true;
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
