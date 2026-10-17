import { field, numberField } from './diagnostic-values.ts';

// Diagnostic snapshots only; never reset renderer.info to obtain convenient counts.
// Accept native renderers and historical fixture snapshots, validating their
// optional counters rather than asserting that every renderer has a WebGL API.
export function rendererCounters(renderer?: unknown) {
  const info = field(renderer, 'info');
  const native = field(field(renderer, 'backend'), 'isWebGPUBackend') === true;
  const render = field(info, 'render'),
    compute = field(info, 'compute');
  const programs = field(info, 'programs');
  return {
    rendererFrame: native ? numberField(info, 'frame') : null,
    renderCallsTotal: native ? numberField(render, 'calls') : null,
    renderCallsFrame: native ? numberField(render, 'frameCalls') : null,
    drawCallsFrame:
      numberField(render, 'drawCalls') ?? (native ? null : numberField(render, 'calls')),
    computeCallsTotal: native ? numberField(compute, 'calls') : null,
    computeCallsFrame: native ? numberField(compute, 'frameCalls') : null,
    shaderStagesLive: native ? numberField(field(info, 'memory'), 'programs') : null,
    webglProgramsLive: native ? null : Array.isArray(programs) ? programs.length : null,
  };
}
