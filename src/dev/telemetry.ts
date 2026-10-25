import * as THREE from 'three';

import type { EngineContext, EngineSystems } from '../core/context.ts';
import type { EngineEventMap, EngineEventName } from '../core/events.ts';
import { STANCE } from '../player/tuning.ts';
import {
  entries,
  field,
  heapMb,
  numberField,
  programCount,
  stringField,
} from './diagnostic-values.ts';
import { trackNodeBuilders } from './native-builds.ts';
import { rendererCounters } from './render-info.ts';

type TelemetrySummary = {
  duration: number | null;
  rawDuration: number | null;
  playerSamples: number;
  enemySamples: number;
  events: number;
  markers: number;
  maxAlive: number;
  counts: Record<string, number>;
  hitches: number;
  hitchDropped: number;
  worstHitchMs: number | null;
  longTasks: number;
  longTaskDropped: number;
  longTaskMs: number | null;
};
type MarkProbe = {
  pose: {
    feet: RecordedVector | null;
    eye: RecordedVector | null;
    forward: (number | null)[];
    yaw: number | null;
    pitch: number | null;
    fov: number | null;
    stance: 'stand' | 'crouch' | 'prone';
    height: number | null;
    radius: number | null;
  };
  aim: {
    visual: {
      mesh: string;
      palette: {} | null;
      instanceGroup: {} | null;
      instanceIndex: number | null | undefined;
      distance: number | null;
      point: RecordedVector | null;
      normal: (number | null)[] | null;
    } | null;
    physics: {
      mesh: string | null;
      surface: string;
      distance: number | null;
      point: RecordedVector | null;
      normal: RecordedVector | null;
    } | null;
    gap: number | null;
  };
  fit: {
    opening: { lintelY: number | null; openLowY: number | null };
    stand?: { pass: boolean; distance: number | null; surface: string | null } | undefined;
    crouch?: { pass: boolean; distance: number | null; surface: string | null } | undefined;
    prone?: { pass: boolean; distance: number | null; surface: string | null } | undefined;
  };
  near: {
    building: string | null;
    buildingLook: string | null;
    groundFeet: number | null;
    groundHit: number | null;
    instances: {
      group: {};
      index: number;
      palette: {} | null;
      distance: number | null;
      position: (number | null)[];
      bbox: { min: (number | null)[]; max: (number | null)[] };
    }[];
  };
};
type PlayerSample = {
  renderCalls: number;
  triangles: number;
  rendererFrame: number | null;
  renderCallsTotal: number | null;
  renderCallsFrame: number | null;
  drawCallsFrame: number | null;
  computeCallsTotal: number | null;
  computeCallsFrame: number | null;
  shaderStagesLive: number | null;
  webglProgramsLive: number | null;
  t: number | null;
  raw: number | null;
  frame: number;
  position: RecordedVector | null;
  eye: RecordedVector | null;
  velocity: RecordedVector | null;
  yaw: number | null;
  pitch: number | null;
  fov: number | null;
  state: string | null;
  stance: 'stand' | 'crouch' | 'prone';
  grounded: boolean;
  sprinting: boolean;
  tacticalSprint: boolean;
  sliding: boolean;
  mantling: boolean;
  health: number | null;
  armour: number | null;
  suppression: number | null;
  dead: boolean;
  bandages: number;
  healing: boolean;
  healProgress: number | null;
  weapon: string;
  mode: string | null;
  ammo: number | null;
  reserve: number | null;
  reloading: boolean;
  ads: boolean;
  grenades: number;
  actions: string[];
  move: (number | null)[];
  look: (number | null)[];
  wave: number;
  remaining: number;
  incoming: boolean;
  score: number;
  kills: number;
  marketOpen: boolean;
  credits: number;
  contacts: number;
  dt: number | null;
  scale: number | null;
};
type EnemySample = {
  t: number | null;
  raw: number | null;
  frame: number;
  alive: number;
  enemies: {
    id: number;
    variant: string;
    position: RecordedVector | null;
    velocity: RecordedVector | null;
    yaw: number | null;
    speed: number | null;
    health: number | null;
    state: string;
    stateTime: number | null;
    squad: number | null;
    role: string;
    crouch: boolean;
    peeking: boolean;
    wantFire: boolean;
    suppression: number | null;
    hasTarget: boolean;
    targetVisible: boolean;
    lastKnown: RecordedVector | null;
    lastKnownAge: number | null;
    visualAge: number | null;
    combatAction: string | null;
    contactKind: string | null;
    targetSample: number;
    observationSearch: boolean;
    coverFailure: string | null;
    elevatedRole: boolean;
    elevationStatus: string | null;
    lastSeenAge: number | null;
    lastFiredAge: number | null;
    cover: (number | null)[] | null;
    coverPosition: RecordedVector | null;
    moveTarget: RecordedVector | null;
    pathLength: number;
    pathIndex: number;
    pathRequest: RecordedVector | null;
    waypoint: RecordedVector | null;
    path: (RecordedVector | null)[] | null;
    vault: string | null;
    vaultT: number | null;
    recovery: string | null;
    recoveryAttempts: number;
    relocations: number;
    rollback: { t: number; from: THREE.Vector3Tuple; to: THREE.Vector3Tuple } | null;
    searchTravelUntil: number | null;
    searchUntil: number | null;
    pathPending: boolean;
    stuckTime: number | null;
    fireBlock: string | null;
    pathOutcome: string | null;
    pathObjective: string | null;
    pathReqFloor: number | null;
    pathResFloor: number | null;
    navFloor: number | null;
    navSurface: number | null;
    navComponent: number | null;
    pathReason: string | null;
    pathStartSurface: number | null;
    pathGoalSurface: number | null;
    search: string | null;
    lodIrrelevant: boolean;
    hudContact: boolean;
    hudPosition: (number | null)[] | null;
    hudFade: number | null;
  }[];
  squads: {
    id: number;
    alive: number;
    intent: import('../ai/intent.ts').IntentName;
    why: string;
    contactAge: number | null;
    planted: boolean;
    wrapper: number | null;
    flanker: number | null;
  }[];
};
type TelemetrySnapshot = {
  schema: number;
  meta: TelemetryMeta | null;
  summary: TelemetrySummary;
  playerSamples: PlayerSample[];
  enemySamples: EnemySample[];
  events: TelemetryEvent[];
  markers: TelemetryMark[];
  hitches: HitchRecord[];
  longTasks: LongTaskRecord[];
};

const PLAYER_HZ = 10;
const ENEMY_HZ = 5;
const ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'crouch',
  'prone',
  'sprint',
  'reload',
  'use',
  'leanLeft',
  'leanRight',
  'swapWeapon',
  'grenade',
  'radio',
  'heal',
] as const;
const EVENTS = [
  'weapon:fire',
  'weapon:reload',
  'shot:resolved',
  'bullet:impact',
  'damage:dealt',
  'damage:taken',
  'actor:death',
  'ai:bark',
  'wave:start',
  'wave:complete',
  'score:change',
  'market:open',
  'market:close',
  'ammo:pickup',
  'player:state',
  'player:jump',
  'player:mantle',
  'player:land',
  'player:footstep',
  'player:death',
  'player:respawn',
  'player:heal',
  'hud:heard',
  'hud:search',
  'radio:strike',
  'explosion',
  'game:restart',
  'engine:error',
] as const satisfies readonly EngineEventName[];
type EventTuple = {
  [K in EngineEventName]: [type: K, payload: EngineEventMap[K]];
}[EngineEventName];

/*
 * Freeze probing.
 *
 * `ctx.time.raw` is clamped to 100 ms per frame (src/core/engine.ts), so a four
 * SECOND hang and a 120 ms stutter advance the recorded timeline by the same
 * 0.1 s. The freeze is erased exactly when it is big enough to matter, which is
 * why this recorder keeps an unclamped wall clock of its own and reports frame
 * gaps against it.
 */
const HITCH_MS = 50;
const HITCH_EMA = 3;
const MAX_RECORDS = 400;

/**
 * One frame's verdict against the adaptive threshold, exported so the rule can
 * be simulated without a browser.
 *
 * A frame is a hitch when it is longer than both HITCH_MS and HITCH_EMA x the
 * recent frame time. EVERY frame feeds that baseline, but a stall contributes at
 * most the current threshold to it: a machine slower than HITCH_MS has to raise
 * the bar, otherwise the baseline can never move and every single frame is
 * logged forever.
 */
export function hitchVerdict(
  ema: number,
  ms: number
): { threshold: number; hitch: boolean; ema: number } {
  const threshold = Math.max(HITCH_MS, ema * HITCH_EMA);
  return {
    threshold,
    hitch: ms >= threshold,
    ema: ema * 0.9 + Math.min(ms, threshold) * 0.1,
  };
}

/** Build revision / world identity. Missing values are `unknown`, never invented. */
export function collectProvenance(input: { revision?: unknown; world?: unknown } = {}):
  | { revision: string; world: string }
  | {
      revision: string;
      world: { sourceHash: string; visual: string; collision: string; nav: string };
    } {
  const revision =
    typeof input.revision === 'string' && input.revision ? input.revision : 'unknown';
  const src = input.world;
  if (!src || src === 'unknown') return { revision, world: 'unknown' };
  return {
    revision,
    world: {
      sourceHash: stringField(src, 'sourceHash') || 'unknown',
      visual: stringField(src, 'visual') || 'unknown',
      collision: stringField(src, 'collision') || 'unknown',
      nav: stringField(src, 'nav') || 'unknown',
    },
  };
}

const shortUrl = (u: unknown): string | null =>
  typeof u === 'string' && u ? u.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '') : null;

/** Keep the worst `max` records: a long session must not grow without bound, and
 *  the freezes worth reading are the slow ones. Returns true when rejected. */
function pushWorst<K extends string, T extends Record<K, number | null>>(
  list: T[],
  rec: T,
  max: number,
  key: K
): boolean {
  if (list.length < max) {
    list.push(rec);
    return false;
  }
  let min = 0;
  for (let i = 1; i < list.length; i++) if ((list[i][key] ?? 0) < (list[min][key] ?? 0)) min = i;
  if ((rec[key] ?? 0) <= (list[min][key] ?? 0)) return true;
  list[min] = rec;
  return false;
}

const n3 = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
type RecordedVector = [number | null, number | null, number | null];
const vec = (v: THREE.Vector3 | null | undefined): RecordedVector | null =>
  v && Number.isFinite(v.x) ? [n3(v.x), n3(v.y), n3(v.z)] : null;
const weaponId = (w: unknown): string | null =>
  typeof w === 'string'
    ? w
    : (stringField(w, 'id') ?? stringField(w, 'label') ?? stringField(w, 'name'));

function entityId(v: unknown): string | null {
  if (!v) return null;
  if (v === 'player' || field(v, 'isPlayer') === true) return 'player';
  const id = numberField(v, 'id');
  if (id !== null) return `ai:${id}`;
  return stringField(v, 'name');
}

function isInstancedMesh(mesh: THREE.Object3D): mesh is THREE.InstancedMesh<THREE.BufferGeometry> {
  return mesh instanceof THREE.InstancedMesh;
}

const TAR_BLOCK = 512;
const SCHEMA = 4;
const shotName = (i: number): string => `marks/${String(i + 1).padStart(3, '0')}.jpg`;

function buildingId(
  world: EngineSystems['world'] | null,
  x: number,
  z: number,
  out: THREE.Vector3
): string | null {
  if (!world) return null;
  const p = world.worldToLevel(x, 0, z, out);
  for (const raw of world.buildings ?? []) {
    const b = 'spec' in raw ? raw.spec : raw;
    if (p.x > b.x - b.w / 2 && p.x < b.x + b.w / 2 && p.z > b.z - b.d / 2 && p.z < b.z + b.d / 2)
      return stringField(b, 'id');
  }
  return null;
}

function tarHeader(name: string, size: number): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(TAR_BLOCK);
  const put = (off: number, str: string, len: number): void => {
    for (let i = 0; i < str.length && i < len; i++) h[off + i] = str.charCodeAt(i);
  };
  put(0, name, 100);
  put(100, '0000644', 8);
  put(108, '0000000', 8);
  put(116, '0000000', 8);
  put(124, `${size.toString(8).padStart(11, '0')}\0`, 12);
  put(
    136,
    `${Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0')}\0`,
    12
  );
  put(148, '        ', 8);
  h[156] = 0x30;
  put(257, 'ustar', 6);
  put(263, '00', 2);
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) sum += h[i];
  put(148, `${sum.toString(8).padStart(6, '0')}\0 `, 8);
  return h;
}

export function extractTar(buf: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const text = new TextDecoder();
  let offset = 0;
  while (offset + TAR_BLOCK <= buf.length) {
    const name = text.decode(buf.subarray(offset, offset + 100)).replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(text.decode(buf.subarray(offset + 124, offset + 136)), 8);
    offset += TAR_BLOCK;
    files[name] = buf.subarray(offset, offset + size);
    offset += size;
    const pad = (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK;
    if (pad) offset += pad;
  }
  return files;
}

function buildTar(files: Array<{ name: string; data: Uint8Array }>): Uint8Array<ArrayBuffer> {
  const parts = [];
  for (const file of files) {
    const data = file.data;
    parts.push(tarHeader(file.name, data.byteLength));
    parts.push(data);
    const pad = (TAR_BLOCK - (data.byteLength % TAR_BLOCK)) % TAR_BLOCK;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(TAR_BLOCK * 2));
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export async function packTgz(
  files: Array<{ name: string; data: Uint8Array }>
): Promise<Uint8Array<ArrayBuffer>> {
  const tar = buildTar(files);
  const stream = new Blob([tar]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Opt-in local gameplay recorder. Loaded only for `?telemetry=1` and started
 * after shader pre-warm, so ordinary play and capture runs pay no cost.
 */
interface TelemetryEvent extends Record<string, unknown> {
  type: string;
}
type TelemetryMark = {
  pose: {
    feet: RecordedVector | null;
    eye: RecordedVector | null;
    forward: (number | null)[];
    yaw: number | null;
    pitch: number | null;
    fov: number | null;
    stance: 'stand' | 'crouch' | 'prone';
    height: number | null;
    radius: number | null;
  };
  aim: {
    visual: {
      mesh: string;
      palette: {} | null;
      instanceGroup: {} | null;
      instanceIndex: number | null | undefined;
      distance: number | null;
      point: RecordedVector | null;
      normal: (number | null)[] | null;
    } | null;
    physics: {
      mesh: string | null;
      surface: string;
      distance: number | null;
      point: RecordedVector | null;
      normal: RecordedVector | null;
    } | null;
    gap: number | null;
  };
  fit: {
    opening: { lintelY: number | null; openLowY: number | null };
    stand?: { pass: boolean; distance: number | null; surface: string | null } | undefined;
    crouch?: { pass: boolean; distance: number | null; surface: string | null } | undefined;
    prone?: { pass: boolean; distance: number | null; surface: string | null } | undefined;
  };
  near: {
    building: string | null;
    buildingLook: string | null;
    groundFeet: number | null;
    groundHit: number | null;
    instances: {
      group: {};
      index: number;
      palette: {} | null;
      distance: number | null;
      position: (number | null)[];
      bbox: { min: (number | null)[]; max: (number | null)[] };
    }[];
  };
  t: number | null;
  raw: number | null;
  frame: number;
  wall: number | null;
  label: string;
  note: string;
  screenshot: string | null;
  player: RecordedVector | null;
};
type TelemetryApi = Pick<
  TelemetrySystem,
  'start' | 'stop' | 'mark' | 'download' | 'snapshot' | 'summary'
>;
type TelemetryMeta = {
  schema: number;
  startedAt: string;
  quality: 'high' | 'low' | 'medium' | 'ultra';
  deterministic: boolean;
  viewport: number[];
  userAgent: string;
  playerHz: number;
  enemyHz: number;
  observers: string | null;
  path: string;
  transform: number[] | null;
  provenance:
    | { revision: string; world: string }
    | {
        revision: string;
        world: { sourceHash: string; visual: string; collision: string; nav: string };
      };
};
type HitchRecord = ReturnType<TelemetrySystem['_hitchRecord']>;
type LongTaskRecord =
  | ReturnType<TelemetrySystem['_loafRecord']>
  | ReturnType<TelemetrySystem['_taskRecord']>;
interface RenderSnapshot {
  programs: number | null;
  nodeBuilders: number | null;
  geometries: number;
  textures: number;
  heapMb: number | null;
}

declare global {
  interface Window {
    __TELEMETRY__?: TelemetryApi;
    __BUILD_REVISION__?: string;
  }
}

export class TelemetrySystem {
  declare ctx: EngineContext;
  declare recording: boolean;
  declare exported: boolean;
  declare playerSamples: ReturnType<TelemetrySystem['_playerSample']>[];
  declare enemySamples: ReturnType<TelemetrySystem['_enemySample']>[];
  declare events: TelemetryEvent[];
  declare markers: TelemetryMark[];
  declare _off: Array<() => void>;
  declare _enemyState: Map<number, string>;
  declare _contacts: Map<number, string>;
  declare _move: { x: number; y: number };
  declare _maxAlive: number;
  declare _lastBadgeAt: number;
  declare hitches: HitchRecord[];
  declare longTasks: LongTaskRecord[];
  declare _hitchDropped: number;
  declare _taskDropped: number;
  declare _frameEma: number;
  declare _lastFrameWall: number | null;
  declare _startWall: number;
  declare _resumedAt: number | null;
  declare _prevInfo: RenderSnapshot | null;
  declare _loafObs: PerformanceObserver | null;
  declare _observers: string | null;
  declare _shots: Array<Blob | undefined>;
  declare _grabQueue: TelemetryMark[];
  declare _grabbing: Promise<void> | null;
  declare _noteMark: TelemetryMark | null;
  declare _offscreen: HTMLCanvasElement | null;
  declare _raycaster: THREE.Raycaster;
  declare _v: THREE.Vector3;
  declare _v2: THREE.Vector3;
  declare _box: THREE.Box3;
  declare _mat: THREE.Matrix4;
  declare badge: HTMLDivElement;
  declare _onKey: (event: KeyboardEvent) => void;
  declare _onBeforeUnload: (event: BeforeUnloadEvent) => void;
  declare _onVisibility: () => void;
  declare api: TelemetryApi;
  declare meta: TelemetryMeta | null;
  declare _note: HTMLDivElement;
  declare _noteInput: HTMLInputElement;
  declare _restoreFrozen: boolean | null;
  declare _restoreEnabled: boolean | null;
  declare _restoreControl: boolean | null;
  declare _nativeBuilds: ReturnType<typeof trackNodeBuilders> | null;
  declare _startElapsed: number;
  declare _startRaw: number;
  declare _stopElapsed: number | null;
  declare _stopRaw: number | null;
  declare _nextPlayerRaw: number;
  declare _nextEnemyRaw: number;
  declare _provenanceReady: Promise<void> | null;

  static id = 'telemetry';
  static deps = ['ui', 'audio'];

  async init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.recording = false;
    this.exported = false;
    this.playerSamples = [];
    this.enemySamples = [];
    this.events = [];
    this.markers = [];
    this._off = [];
    this._enemyState = new Map();
    this._contacts = new Map();
    this._move = { x: 0, y: 0 };
    this._maxAlive = 0;
    this._lastBadgeAt = -Infinity;
    this.hitches = [];
    this.longTasks = [];
    this._hitchDropped = 0;
    this._taskDropped = 0;
    this._frameEma = 16.7;
    this._lastFrameWall = null;
    this._startWall = 0;
    this._resumedAt = null;
    this._prevInfo = null;
    this._loafObs = null;
    this._observers = null;
    this._shots = [];
    this._grabQueue = [];
    this._grabbing = null;
    this._noteMark = null;
    this._offscreen = null;
    this._raycaster = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._box = new THREE.Box3();
    this._mat = new THREE.Matrix4();

    for (const type of EVENTS) {
      this._off.push(ctx.events.on(type, (e): void => this._recordEvent(type, e)));
    }

    const render = ctx.peek('render');
    if (render?.render) {
      const orig = render.render.bind(render);
      render.render = (c): void => {
        orig(c);
        this._afterRender();
      };
    }

    this.badge = document.createElement('div');
    this.badge.textContent = 'TELEMETRY ARMED';
    Object.assign(this.badge.style, {
      position: 'fixed',
      left: '50%',
      bottom: '8px',
      zIndex: '100000',
      transform: 'translateX(-50%)',
      padding: '6px 9px',
      color: '#d7f7ff',
      background: 'rgba(2,8,12,.82)',
      border: '1px solid rgba(90,210,255,.55)',
      borderRadius: '3px',
      font: '600 10px/1.2 ui-monospace,monospace',
      letterSpacing: '.08em',
      pointerEvents: 'none',
      userSelect: 'none',
    });
    document.body.appendChild(this.badge);
    this._buildNoteUi();

    this._onKey = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      if (this._noteMark && (e.code === 'Escape' || e.code === 'Enter')) {
        e.preventDefault();
        if (e.code === 'Enter') this._closeNote();
        return;
      }
      if (e.code === 'F7') {
        e.preventDefault();
        if (this._noteMark) this._closeNote();
        this.mark();
      } else if (e.code === 'F8') {
        e.preventDefault();
        void this.download();
      }
    };
    this._onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (this.exported || (!this.events.length && !this.playerSamples.length)) return;
      e.preventDefault();
      e.returnValue = '';
    };
    // A hidden tab stops rAF entirely, which looks exactly like an enormous
    // freeze. Remember when the page came back so those can be labelled.
    this._onVisibility = (): void => {
      if (!this.recording || document.hidden) return;
      this._resumedAt = performance.now();
    };
    addEventListener('visibilitychange', this._onVisibility);
    addEventListener('keydown', this._onKey, true);
    addEventListener('beforeunload', this._onBeforeUnload);

    const api = {
      start: (): { recording: boolean; startedAt: string } => this.start(),
      stop: (): TelemetrySummary => this.stop(),
      mark: (label?: string): TelemetryMark | null => this.mark(label),
      download: (): Promise<{
        filename: string;
        bytes: number;
        summary: TelemetrySummary;
      } | null> => this.download(),
      snapshot: (): TelemetrySnapshot => this.snapshot(),
      summary: (): TelemetrySummary => this.summary(),
    };
    this.api = api;
    window.__TELEMETRY__ = api;
  }

  start(): { recording: boolean; startedAt: string } {
    this._nativeBuilds?.dispose();
    this._nativeBuilds = trackNodeBuilders(this.ctx.peek('render')?.renderer);
    const t = this.ctx.time;
    this.playerSamples.length = 0;
    this.enemySamples.length = 0;
    this.events.length = 0;
    this.markers.length = 0;
    this._shots.length = 0;
    this._grabQueue.length = 0;
    this._grabbing = null;
    this._closeNote();
    this._enemyState.clear();
    this._contacts.clear();
    this._maxAlive = 0;
    this.hitches.length = 0;
    this.longTasks.length = 0;
    this._hitchDropped = 0;
    this._taskDropped = 0;
    this._frameEma = 16.7;
    this._lastFrameWall = null;
    this._startWall = performance.now();
    this._resumedAt = null;
    this._prevInfo = null;
    this._startElapsed = t.elapsed;
    this._startRaw = t.raw;
    this._stopElapsed = null;
    this._stopRaw = null;
    this._nextPlayerRaw = 0;
    this._nextEnemyRaw = 0;
    this._lastBadgeAt = -Infinity;
    this.recording = true;
    this.exported = false;
    this._startObservers();
    this.meta = this._createMeta();
    this._provenanceReady = null;
    this._fillWorldProvenance();
    this._push('session:start', { quality: this.ctx.config.quality });
    this._updateBadge(true);
    return { recording: true, startedAt: this.meta.startedAt };
  }

  _createMeta(): TelemetryMeta {
    const xform = this.ctx.peek('world')?._xform;
    return {
      schema: SCHEMA,
      startedAt: new Date().toISOString(),
      quality: this.ctx.config.quality,
      deterministic: !!this.ctx.config.deterministic,
      viewport: [innerWidth, innerHeight],
      userAgent: navigator.userAgent,
      playerHz: PLAYER_HZ,
      enemyHz: ENEMY_HZ,
      observers: this._observers,
      path: location.pathname,
      transform: xform ? Array.from(xform.elements) : null,
      provenance: collectProvenance({
        revision: stringField(this.ctx.config, 'revision') ?? window.__BUILD_REVISION__,
      }),
    };
  }

  stop(): TelemetrySummary {
    if (!this.recording) return this.summary();
    this._push('session:stop', {});
    this._stopElapsed = this.ctx.time.elapsed;
    this._stopRaw = this.ctx.time.raw;
    this.recording = false;
    this._nativeBuilds?.dispose();
    this._stopObservers();
    this._updateBadge(true);
    return this.summary();
  }

  mark(label: string = 'manual'): TelemetryMark | null {
    if (!this.recording) return null;
    const m = this._createMark(label);
    this.markers.push(m);
    this._grabQueue.push(m);
    this.badge.textContent = `MARK ${this.markers.length} SAVED · F8 EXPORT`;
    this._openNote(m);
    return m;
  }

  _createMark(label: string): TelemetryMark {
    const player = this.ctx.get('player');
    return {
      t: this._time(),
      raw: this._rawTime(),
      frame: this.ctx.time.frame,
      wall: this._wall(),
      label: String(label || 'manual').slice(0, 80),
      note: '',
      screenshot: null as string | null,
      player: vec(player.feetPosition),
      ...this._probeMark(player),
    };
  }

  _probeMark(player: EngineSystems['player']): MarkProbe {
    const world = this.ctx.peek('world');
    const physics = this.ctx.get('physics');
    const cam = this.ctx.camera;
    const feet = player.feetPosition;
    const eye = cam.position;
    const forward = this._v2.copy(player.forward).normalize();
    const character = player.movement.character;
    if (!character) throw new Error('[telemetry] player character is unavailable');
    const radius = character.radius;
    const visual = this._aimVisual(world, eye, forward);
    const physHit = physics.raycast(eye, forward, 24, physics.MASK.WORLD);
    const phys = physHit.hit
      ? {
          mesh: stringField(physHit.object, 'name'),
          surface: physHit.surface,
          distance: n3(physHit.distance),
          point: vec(physHit.point),
          normal: vec(physHit.normal),
        }
      : null;
    const hit = visual?.point ?? phys?.point;
    const hx = hit?.[0] ?? eye.x + forward.x * 4;
    const hz = hit?.[2] ?? eye.z + forward.z * 4;
    const groundAt = (x: number, z: number, fromY: number): number | null => {
      const y = physics.groundHeight(x, z, fromY);
      return Number.isFinite(y) ? n3(y) : null;
    };
    return {
      pose: {
        feet: vec(feet),
        eye: vec(eye),
        forward: [n3(forward.x), n3(forward.y), n3(forward.z)],
        yaw: n3(player.yaw),
        pitch: n3(player.pitch),
        fov: n3(cam.fov),
        stance: player.stance,
        height: n3(player.height),
        radius: n3(radius),
      },
      aim: {
        visual,
        physics: phys,
        gap: visual && phys ? n3(phys.distance! - visual.distance!) : null,
      },
      fit: this._fitProbe(physics, feet, forward, radius),
      near: {
        building: buildingId(world, feet.x, feet.z, this._v),
        buildingLook: buildingId(world, hx, hz, this._v),
        groundFeet: groundAt(feet.x, feet.z, feet.y + 2),
        groundHit: hit ? groundAt(hit[0]!, hit[2]!, hit[1]! + 2) : null,
        instances: this._nearbyInstances(world, hit ?? [feet.x, feet.y, feet.z]),
      },
    };
  }

  _aimVisual(
    world: EngineSystems['world'] | null,
    origin: THREE.Vector3,
    dir: THREE.Vector3
  ): {
    mesh: string;
    palette: {} | null;
    instanceGroup: {} | null;
    instanceIndex: number | null | undefined;
    distance: number | null;
    point: RecordedVector | null;
    normal: (number | null)[] | null;
  } | null {
    this._raycaster.far = 24;
    this._raycaster.set(origin, dir);
    const hit = this._raycaster.intersectObjects(world?.meshes ?? [], false)[0];
    if (!hit) return null;
    const mesh = hit.object;
    let normal = null;
    if (hit.face) {
      if (
        mesh instanceof THREE.InstancedMesh &&
        hit.instanceId !== undefined &&
        Number.isInteger(hit.instanceId)
      ) {
        mesh.getMatrixAt(hit.instanceId, this._mat);
        this._v.copy(hit.face.normal).transformDirection(this._mat).normalize();
      } else {
        this._v.copy(hit.face.normal).transformDirection(mesh.matrixWorld).normalize();
      }
      normal = [n3(this._v.x), n3(this._v.y), n3(this._v.z)];
    }
    return {
      mesh: mesh.name ?? null,
      palette: field(mesh.userData, 'palette') ?? null,
      instanceGroup:
        mesh instanceof THREE.InstancedMesh
          ? (field(mesh.userData, 'cod_instance_group') ?? mesh.name)
          : null,
      instanceIndex: Number.isInteger(hit.instanceId) ? hit.instanceId : null,
      distance: n3(hit.distance),
      point: vec(hit.point),
      normal,
    };
  }

  _fitProbe(
    physics: EngineSystems['physics'],
    feet: THREE.Vector3,
    forward: THREE.Vector3,
    radius: number
  ): {
    opening: { lintelY: number | null; openLowY: number | null };
    stand?: { pass: boolean; distance: number | null; surface: string | null } | undefined;
    crouch?: { pass: boolean; distance: number | null; surface: string | null } | undefined;
    prone?: { pass: boolean; distance: number | null; surface: string | null } | undefined;
  } {
    const horiz = { x: forward.x, y: 0, z: forward.z };
    const hl = Math.hypot(horiz.x, horiz.z) || 1;
    horiz.x /= hl;
    horiz.z /= hl;
    const fit: Partial<
      Record<
        'stand' | 'crouch' | 'prone',
        { pass: boolean; distance: number | null; surface: string | null }
      >
    > = {};
    for (const name of ['stand', 'crouch', 'prone'] as const) {
      const h = STANCE[name].height;
      const hit = physics.capsuleCast(
        { x: feet.x, y: feet.y + radius, z: feet.z },
        { x: feet.x, y: feet.y + h - radius, z: feet.z },
        radius,
        horiz,
        3.2,
        physics.MASK.CHARACTER
      );
      fit[name] = {
        pass: !hit.hit || hit.distance > 0.45,
        distance: hit.hit ? n3(hit.distance) : null,
        surface: hit.hit ? hit.surface : null,
      };
    }
    let openLow = null;
    let openHigh = null;
    for (let h = 0.2; h <= 2.24; h += 0.08) {
      const hit = physics.raycast(
        feet.x,
        feet.y + h,
        feet.z,
        horiz.x,
        0,
        horiz.z,
        3.2,
        physics.MASK.WORLD
      );
      const blocked = hit.hit && hit.distance < 2.6;
      if (blocked) {
        if (openLow != null && openHigh == null) openHigh = h;
      } else if (openLow == null) {
        openLow = h;
      }
    }
    if (openLow != null && openHigh == null) openHigh = 2.24;
    return {
      ...fit,
      opening: {
        lintelY: openHigh != null ? n3(feet.y + openHigh) : null,
        openLowY: openLow != null ? n3(feet.y + openLow) : null,
      },
    };
  }

  _nearbyInstances(
    world: EngineSystems['world'] | null,
    ref: RecordedVector
  ): {
    group: {};
    index: number;
    palette: {} | null;
    distance: number | null;
    position: (number | null)[];
    bbox: { min: (number | null)[]; max: (number | null)[] };
  }[] {
    const rx = ref[0],
      ry = ref[1],
      rz = ref[2];
    if (rx === null || ry === null || rz === null) return [];
    const rows = [];
    for (const mesh of world?.meshes ?? []) {
      if (!isInstancedMesh(mesh)) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const group = field(mesh.userData, 'cod_instance_group') ?? mesh.name;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, this._mat);
        this._v.setFromMatrixPosition(this._mat);
        const d = Math.hypot(this._v.x - rx, this._v.y - ry, this._v.z - rz);
        if (d > 4) continue;
        this._box.copy(mesh.geometry.boundingBox!).applyMatrix4(this._mat);
        rows.push({
          group,
          index: i,
          palette: field(mesh.userData, 'palette') ?? null,
          distance: n3(d),
          position: [n3(this._v.x), n3(this._v.y), n3(this._v.z)],
          bbox: {
            min: [n3(this._box.min.x), n3(this._box.min.y), n3(this._box.min.z)],
            max: [n3(this._box.max.x), n3(this._box.max.y), n3(this._box.max.z)],
          },
        });
      }
    }
    rows.sort((a, b): number => a.distance! - b.distance!);
    return rows.slice(0, 16);
  }

  lateUpdate(): void {
    if (!this.recording) {
      // Clear the clock so stopping and starting again does not book the
      // pause as one giant hitch.
      this._lastFrameWall = null;
      return;
    }
    const now = performance.now();
    this._probeFrame(now);
    this._snapInfo();
    const raw = this._rawTime() as number;
    if (raw >= this._nextPlayerRaw) {
      this._samplePlayer();
      this._nextPlayerRaw = raw + 1 / PLAYER_HZ;
    }
    if (raw >= this._nextEnemyRaw) {
      this._sampleEnemies();
      this._nextEnemyRaw = raw + 1 / ENEMY_HZ;
    }
    this._updateBadge();
  }

  /** Unclamped wall-clock seconds since recording started. Every hitch and long
   *  task is keyed on this clock rather than on the game's clamped one. */
  _wall(now: number = performance.now()): number | null {
    return n3((now - this._startWall) / 1000);
  }

  /**
   * Tier 1: time the gap between lateUpdates. lateUpdate runs once per frame
   * whatever the sampling rates are, so this sees every stall; the frame it is
   * booked against covers the previous frame's render plus this frame's update,
   * and carries the resource deltas needed to blame something.
   */
  _probeFrame(now: number): void {
    const last = this._lastFrameWall;
    this._lastFrameWall = now;
    if (last == null) return;
    const ms = now - last;
    const verdict = hitchVerdict(this._frameEma, ms);
    this._frameEma = verdict.ema;
    if (!verdict.hitch) return;
    const rec = this._hitchRecord(now, ms, last);
    if (pushWorst(this.hitches, rec, MAX_RECORDS, 'wallMs')) this._hitchDropped++;
    this._updateBadge(true);
  }

  _hitchRecord(
    now: number,
    ms: number,
    last: number
  ): {
    render: {
      dPrograms: number | null;
      dNodeBuilders: number | null;
      dGeometries: number | null;
      dTextures: number | null;
    };
    heapMb: number | null;
    dHeapMb: number | null;
    wall: number | null;
    wallMs: number | null;
    frame: number;
    t: number | null;
    gameDtMs: number | null;
    suspended: boolean;
  } {
    return {
      wall: this._wall(now),
      wallMs: n3(ms),
      frame: this.ctx.time.frame,
      t: this._time(),
      gameDtMs: n3(this.ctx.time.dt * 1000),
      suspended: this._resumedAt != null && last < this._resumedAt,
      ...this._frameDeltas(),
    };
  }

  /** Last frame's resource counters, so a hitch can show what jumped inside it. */
  _snapInfo(): void {
    const info = this.ctx.peek('render')?.renderer?.info;
    if (!info) return;
    this._prevInfo = {
      programs: programCount(info),
      nodeBuilders: this._nativeBuilds?.count ?? null,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      heapMb: heapMb(),
    };
  }

  /**
   * What changed inside the gap: WebGL programs, native node builders and
   * resource counts. These are activity signals, not GPU compilation timings
   * or proof that a resource was uploaded. Nothing else is recorded here — the
   * player, wave, market and AI state already land in the samples, and the
   * analyzer joins a hitch to the sample next to it rather than storing the same
   * snapshot twice.
   */
  _frameDeltas(): {
    render: {
      dPrograms: number | null;
      dNodeBuilders: number | null;
      dGeometries: number | null;
      dTextures: number | null;
    };
    heapMb: number | null;
    dHeapMb: number | null;
  } {
    const info = this.ctx.peek('render')?.renderer?.info;
    const prev = this._prevInfo;
    const programs = programCount(info);
    const nodeBuilders = this._nativeBuilds?.count ?? null;
    const geometries = info?.memory?.geometries ?? null;
    const textures = info?.memory?.textures ?? null;
    const heap = heapMb();
    return {
      render: {
        dPrograms: prev?.programs != null && programs != null ? programs - prev.programs : null,
        dNodeBuilders:
          prev?.nodeBuilders != null && nodeBuilders != null
            ? nodeBuilders - prev.nodeBuilders
            : null,
        dGeometries: prev && geometries != null ? geometries - prev.geometries : null,
        dTextures: prev && textures != null ? textures - prev.textures : null,
      },
      heapMb: heap,
      dHeapMb: prev?.heapMb != null && heap != null ? heap - prev.heapMb : null,
    };
  }

  /** Tier 2: who was on the main thread. `long-animation-frame` carries the
   *  blocking scripts; `longtask` is the fallback where that is unsupported.
   *  Both were observed together during development and reported the same stalls
   *  every time, so only one is ever active. */
  _startObservers(): void {
    this._stopObservers(); // `__TELEMETRY__.start()` twice must not leave two observers
    this._observers = null;
    const types = globalThis.PerformanceObserver?.supportedEntryTypes ?? [];
    const type = ['long-animation-frame', 'longtask'].find((name): boolean => types.includes(name));
    if (!type) return; // no observer at all: tier 1 still records the gaps
    try {
      this._loafObs = new PerformanceObserver((list): void => {
        for (const e of list.getEntries()) {
          if (type === 'longtask') this._recordTask(e);
          else this._recordLoaf(e);
        }
      });
      this._loafObs.observe({ type });
      this._observers = type;
    } catch {
      this._observers = null; // older browser: tier 1 still records the gaps
    }
  }

  _stopObservers(): void {
    this._loafObs?.disconnect();
    this._loafObs = null;
  }

  _recordLoaf(e: PerformanceEntry): void {
    if (!this.recording) return;
    const rec = this._loafRecord(e);
    if (pushWorst(this.longTasks, rec, MAX_RECORDS, 'ms')) this._taskDropped++;
  }

  _loafRecord(e: PerformanceEntry): {
    kind: 'loaf';
    wall: number | null;
    ms: number | null;
    blockingMs: number | null;
    scripts: {
      ms: number | null;
      fn: string | null;
      url: string | null;
      type: string | null;
      forcedMs: number | null;
    }[];
  } {
    const scripts = entries(field(e, 'scripts'))
      .sort((a, b): number => (numberField(b, 'duration') ?? 0) - (numberField(a, 'duration') ?? 0))
      .slice(0, 6)
      .map(
        (
          s
        ): {
          ms: number | null;
          fn: string | null;
          url: string | null;
          type: string | null;
          forcedMs: number | null;
        } => ({
          ms: n3(numberField(s, 'duration')),
          fn: stringField(s, 'sourceFunctionName') || null,
          url: shortUrl(field(s, 'sourceURL')),
          type: stringField(s, 'invokerType') || null,
          forcedMs: n3(numberField(s, 'forcedStyleAndLayoutDuration') ?? 0),
        })
      );
    return {
      kind: 'loaf' as const,
      wall: n3((e.startTime - this._startWall) / 1000),
      ms: n3(e.duration),
      blockingMs: n3(numberField(e, 'blockingDuration') ?? 0),
      scripts,
    };
  }

  /** Fallback where `long-animation-frame` is unsupported: the Long Tasks API
   *  reports a duration and a container, but names no function. */
  _recordTask(e: PerformanceEntry): void {
    if (!this.recording) return;
    const rec = this._taskRecord(e);
    if (pushWorst(this.longTasks, rec, MAX_RECORDS, 'ms')) this._taskDropped++;
  }

  _taskRecord(e: PerformanceEntry): {
    kind: 'longtask';
    wall: number | null;
    ms: number | null;
    scripts: { url: string | null }[];
  } {
    const attr = entries(field(e, 'attribution'))[0];
    return {
      kind: 'longtask' as const,
      wall: n3((e.startTime - this._startWall) / 1000),
      ms: n3(e.duration),
      scripts: attr ? [{ url: shortUrl(field(attr, 'containerSrc')) }] : [],
    };
  }

  _time(): number | null {
    const now = this._stopElapsed ?? this.ctx.time.elapsed;
    return n3(now - (this._startElapsed ?? now));
  }

  _rawTime(): number | null {
    const now = this._stopRaw ?? this.ctx.time.raw;
    return n3(now - (this._startRaw ?? now));
  }

  _fillWorldProvenance(): void {
    const session = this.meta;
    this._provenanceReady = this.ctx.get('models').worldPrefetch.then(({ meta }): void => {
      if (!session) return;
      session.provenance = collectProvenance({
        revision: session.provenance.revision,
        world: { sourceHash: field(meta, 'sourceHash'), ...meta.assets },
      });
    });
  }

  _push(type: string, data: Record<string, unknown>): void {
    if (!this.recording) return;
    this.events.push({
      t: this._time(),
      raw: this._rawTime(),
      frame: this.ctx.time.frame,
      type,
      ...data,
    });
  }

  _recordEvent<K extends EngineEventName>(type: K, e: EngineEventMap[K]): void;
  _recordEvent(...[type, e]: EventTuple): void {
    if (!this.recording) return;
    let data;
    switch (type) {
      case 'weapon:fire':
        data = {
          shooter: entityId(e.actor),
          weapon: weaponId(e.weapon),
          origin: vec(e.origin),
          dir: vec(e.dir),
          seed: e.seed ?? null,
        };
        break;
      case 'shot:resolved':
        data = {
          shooter: entityId(e.shooter),
          weapon: weaponId(e.weapon),
          from: vec(e.from),
          to: vec(e.to),
          result: e.result ?? null,
          target: entityId(e.target),
          part: e.part ?? null,
          damage: n3(e.damage),
          pellet: e.pellet ?? 0,
          shot: e.shot ?? null,
          stopReason: e.stopReason ?? null,
        };
        break;
      case 'bullet:impact':
        data = {
          point: vec(e.point),
          normal: vec(e.normal),
          incident: vec(e.incident),
          surface: e.surface ?? null,
          damage: n3(e.damage),
          exit: !!e.exit,
          target: entityId(e.actor),
          part: e.part ?? null,
        };
        break;
      case 'weapon:reload':
        data = {
          actor: entityId(e.actor) ?? 'player',
          weapon: weaponId(e.weapon),
          phase: e.phase ?? null,
        };
        break;
      case 'damage:dealt':
        data = {
          target: entityId(e.target),
          source: entityId(e.source),
          amount: n3(e.amount),
          point: vec(e.point),
          headshot: !!e.headshot,
          killed: !!e.killed,
          explosion: !!e.explosion,
        };
        break;
      case 'damage:taken':
        data = {
          amount: n3(e.amount),
          health: n3(e.health),
          armour: n3(e.armour),
          absorbed: n3(e.armourAbsorbed),
          plateBreak: !!e.plateBreak,
          from: vec(e.from),
        };
        break;
      case 'actor:death':
        data = { actor: entityId(e.actor), point: vec(e.point), impulse: vec(e.impulse) };
        break;
      case 'player:state':
        data = {
          state: e.state ?? null,
          stance: e.stance ?? null,
          sprinting: !!e.sprinting,
          tacticalSprint: !!e.tacticalSprint,
          sliding: !!e.sliding,
          mantling: !!e.mantling,
          grounded: !!e.grounded,
          ads: !!e.ads,
        };
        break;
      case 'player:footstep':
        data = {
          position: vec(e.position),
          surface: e.surface ?? null,
          running: !!e.running,
          speed: n3(e.speed),
          stance: e.stance ?? null,
        };
        break;
      case 'player:jump':
      case 'player:respawn':
      case 'ammo:pickup':
        data = {
          position: vec(e.position),
          amount: 'amount' in e ? e.amount : null,
          weapon: weaponId('weapon' in e ? e.weapon : null),
        };
        break;
      case 'player:mantle':
        data = { kind: e.kind ?? null, height: n3(e.height) };
        break;
      case 'player:land':
        data = { position: vec(e.position), velocity: n3(e.velocity), surface: e.surface ?? null };
        break;
      case 'player:death':
        data = { position: vec(e.position), from: vec(e.from), amount: n3(e.amount) };
        break;
      case 'player:heal':
        data = {
          phase: e.phase,
          amount: n3(e.amount),
          health: n3(e.health),
          bandages: e.bandages,
          reason: e.reason,
        };
        break;
      case 'explosion':
        data = {
          position: vec(e.position),
          radius: n3(e.radius),
          damage: n3(e.damage),
          source: entityId(e.source),
        };
        break;
      case 'wave:start':
        data = { wave: e.wave ?? null, enemies: e.enemies ?? null, squads: e.squads ?? null };
        break;
      case 'wave:complete':
        data = { wave: e.wave ?? null, nextWave: e.nextWave ?? null, delay: n3(e.delay) };
        break;
      case 'score:change':
        data = {
          score: e.score ?? null,
          delta: e.delta ?? null,
          reason: e.reason ?? null,
          kills: e.kills ?? null,
        };
        break;
      case 'market:open':
        data = { wave: e.wave ?? null };
        break;
      case 'market:close':
      case 'game:restart':
        data = { source: e.source ?? null };
        break;
      case 'hud:heard':
        data = { bearing: n3(e.bearing) };
        break;
      case 'hud:search':
        data = { bearing: n3(e.bearing), sector: e.sector ?? null, remaining: e.remaining ?? null };
        break;
      case 'radio:strike':
        data = { position: vec(e.position) };
        break;
      case 'ai:bark':
        data = {
          kind: e.kind ?? null,
          position: vec(e.position),
          actor: e.voice ? `ai:${e.voice}` : null,
        };
        break;
      case 'engine:error':
        data = { system: e.system ?? null, method: e.method ?? null, message: e.message ?? null };
        break;
      default:
        data = {};
        break;
    }
    this._push(type, data);
  }

  _samplePlayer(): void {
    this.playerSamples.push(this._playerSample());
  }

  _playerSample(): PlayerSample {
    const ctx = this.ctx;
    const p = ctx.get('player');
    const w = ctx.get('weapons');
    const ai = ctx.get('ai');
    const game = ctx.get('game');
    const market = ctx.get('market');
    const render = ctx.get('render');
    const hp = p.health;
    const ws = w.state;
    const input = ctx.input;
    const actions = [];
    for (const name of ACTIONS) if (input.action(name)) actions.push(name);
    if (input.fire) actions.push('fire');
    if (input.ads) actions.push('ads');
    input.moveVector(this._move);
    const wave = ai.getWaveState();
    const info = render.renderer.info;

    return {
      t: this._time(),
      raw: this._rawTime(),
      frame: ctx.time.frame,
      position: vec(p.feetPosition ?? p.position),
      eye: vec(ctx.camera.position),
      velocity: vec(p.velocity),
      yaw: n3(p.yaw ?? ctx.camera.rotation.y),
      pitch: n3(ctx.camera.rotation.x),
      fov: n3(ctx.camera.fov),
      state: p.state ?? null,
      stance: p.stance ?? null,
      grounded: p.grounded ?? null,
      sprinting: !!p.sprinting,
      tacticalSprint: !!p.tacticalSprint,
      sliding: !!p.sliding,
      mantling: !!p.mantling,
      health: n3(hp.value),
      armour: n3(hp.armour),
      suppression: n3(hp.suppression),
      dead: !!hp.dead,
      bandages: p.bandages,
      healing: p.healCtrl.active,
      healProgress: n3(p.healCtrl.progress),
      weapon: w.activeId ?? null,
      mode: ws?.mode ?? null,
      ammo: ws?.mag ?? null,
      reserve: ws?.reserve ?? null,
      reloading: !!w.reloading,
      ads: (w.adsProgress ?? 0) > 0.5,
      grenades: w.grenades ?? null,
      actions,
      move: [n3(this._move.x), n3(this._move.y)],
      look: [n3(input.look.x), n3(input.look.y)],
      wave: wave.number,
      remaining: wave.remaining,
      incoming: !!wave.incoming,
      score: game.score,
      kills: game.kills,
      marketOpen: !!market.open,
      credits: market.credits,
      contacts: this._contacts.size,
      dt: n3(ctx.time.dt),
      scale: n3(ctx.time.scale),
      ...rendererCounters(ctx.get('render').renderer),
      renderCalls: info.render.calls,
      triangles: info.render.triangles, // retained cumulative alias
    };
  }

  _sampleEnemies(): void {
    this.enemySamples.push(this._enemySample());
  }

  _enemySample(): EnemySample {
    const ctx = this.ctx;
    const ai = ctx.get('ai');
    const agents = ai.agents;
    const contacts = new Map<number, string>();
    for (const a of ai.getHudActors()) {
      const source = a.lastFired > a.lastSeen ? 'fire' : 'los';
      contacts.set(a.id, source);
      const previousSource = this._contacts.get(a.id);
      if (previousSource === source) continue;
      if (previousSource) {
        this._push('hud:contact', { actor: `ai:${a.id}`, active: false, source: previousSource });
      }
      this._push('hud:contact', {
        actor: `ai:${a.id}`,
        active: true,
        source,
        position: [n3(a.hudX), n3(a.position.y), n3(a.hudZ)],
      });
    }
    for (const [id, source] of this._contacts) {
      if (!contacts.has(id))
        this._push('hud:contact', { actor: `ai:${id}`, active: false, source });
    }
    this._contacts = contacts;

    const rows = [];
    const grid = ai.grid;
    for (const a of agents) {
      if (!a.alive) continue;
      const previous = this._enemyState.get(a.id);
      if (previous !== a.state) {
        this._push('ai:state', { actor: `ai:${a.id}`, from: previous ?? null, to: a.state });
        this._enemyState.set(a.id, a.state);
      }
      const contact = contacts.has(a.id);
      let navFloor = null,
        navSurface = null,
        navComponent = null;
      if (grid) {
        const surface = grid.inspect(a.position);
        if (surface.success && surface.nearestRef) {
          navFloor = n3(surface.nearestPoint.y);
          navSurface = surface.nearestRef;
          navComponent = grid.components.get(navSurface) ?? null;
        }
      }
      rows.push({
        id: a.id,
        variant: a.variantName,
        position: vec(a.position),
        velocity: vec(a.velocity),
        yaw: n3(a.yaw),
        speed: n3(a.speed),
        health: n3(a.health),
        state: a.state,
        stateTime: n3(a.stateTime),
        squad: a.squad?.id ?? null,
        role: a.role ?? null,
        crouch: !!a.crouch,
        peeking: !!a.peeking,
        wantFire: !!a.wantFire,
        suppression: n3(a.suppression),
        hasTarget: !!a.hasTarget,
        targetVisible: !!a.targetVisible,
        lastKnown: vec(a.lastKnown),
        lastKnownAge: n3(a.lastKnownAge),
        visualAge: n3(a.visualAge),
        combatAction: a.combatAction ?? null,
        contactKind: a.lastKnownKind ?? null,
        targetSample: a.targetSample ?? -1,
        observationSearch: !!a._observationSearch,
        coverFailure: a.coverFailure ?? null,
        elevatedRole: a.squad?.elevated === a,
        elevationStatus: a.squad?.elevationStatus ?? null,
        lastSeenAge: n3(ctx.time.elapsed - a.lastSeen),
        lastFiredAge: n3(ctx.time.elapsed - a.lastFired),
        cover: a.cover ? [n3(a.cover.x), n3(a.cover.y), n3(a.cover.z)] : null,
        coverPosition: a.cover ? vec(a.coverPos) : null,
        moveTarget: a.hasMoveTarget ? vec(a.moveTarget) : null,
        pathLength: a.pathLen ?? 0,
        pathIndex: a.pathIndex ?? 0,
        pathRequest: a.pathOutcome ? vec(a._pendingDest) : null,
        waypoint: a.hasMoveTarget ? vec(a.path[a.pathIndex]) : null,
        path: a.hasMoveTarget ? a.path.slice(a.pathIndex, a.pathLen).map(vec) : null,
        vault: a.vaultOutcome ?? null,
        vaultT: n3(a.vaultT),
        recovery: a.recoveryOutcome ?? null,
        recoveryAttempts: a.recoveryAttempts ?? 0,
        relocations: a.relocations ?? 0,
        rollback: a.lastRollback ?? null,
        searchTravelUntil: n3(a._searchTravelUntil),
        searchUntil: n3(a._searchUntil),
        pathPending: !!a.pathPending,
        stuckTime: n3(a.stuckTimer),
        fireBlock: a.fireBlock ?? null,
        pathOutcome: a.pathOutcome ?? null,
        pathObjective: a.pathObjective ?? null,
        pathReqFloor: n3(a.pathReqFloor),
        pathResFloor: n3(a.pathResFloor),
        navFloor,
        navSurface,
        navComponent,
        pathReason: a.pathReason ?? null,
        pathStartSurface: a.pathStartSurface || null,
        pathGoalSurface: a.pathGoalSurface || null,
        search: a.searchOutcome ?? null,
        lodIrrelevant: !!a.lodIrrelevant,
        hudContact: contact,
        hudPosition: contact ? [n3(a.hudX), n3(a.hudZ)] : null,
        hudFade: contact ? n3(a.hudFade) : null,
      });
    }
    const alive = rows.length;
    this._maxAlive = Math.max(this._maxAlive, alive);

    const squads = [];
    for (const s of ai.squads) {
      squads.push({
        id: s.id,
        alive: s.alive,
        intent: s.intent,
        why: s.why,
        contactAge: n3(s.contactAge),
        planted: !!s.planted,
        wrapper: s.wrapper?.id ?? null,
        flanker: s.flanker?.id ?? null,
      });
    }
    return {
      t: this._time(),
      raw: this._rawTime(),
      frame: ctx.time.frame,
      alive,
      enemies: rows,
      squads,
    };
  }

  summary(): TelemetrySummary {
    const counts: Record<string, number> = {};
    for (const e of this.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    let worstHitchMs = 0;
    let longTaskMs = 0;
    for (const h of this.hitches) worstHitchMs = Math.max(worstHitchMs, h.wallMs ?? 0);
    for (const t of this.longTasks)
      longTaskMs += ('blockingMs' in t ? t.blockingMs : null) ?? t.ms ?? 0;
    return {
      duration: this._time(),
      rawDuration: this._rawTime(),
      playerSamples: this.playerSamples.length,
      enemySamples: this.enemySamples.length,
      events: this.events.length,
      markers: this.markers.length,
      maxAlive: this._maxAlive,
      counts,
      hitches: this.hitches.length,
      hitchDropped: this._hitchDropped,
      worstHitchMs: n3(worstHitchMs),
      longTasks: this.longTasks.length,
      longTaskDropped: this._taskDropped,
      longTaskMs: n3(longTaskMs),
    };
  }

  snapshot(): TelemetrySnapshot {
    return {
      schema: SCHEMA,
      meta: this.meta ?? null,
      summary: this.summary(),
      playerSamples: this.playerSamples,
      enemySamples: this.enemySamples,
      events: this.events,
      markers: this.markers,
      hitches: this.hitches,
      longTasks: this.longTasks,
    };
  }

  async download(): Promise<{ filename: string; bytes: number; summary: TelemetrySummary } | null> {
    if (!this.meta) return null;
    this._closeNote();
    if (this.recording) this.stop();
    if (this._provenanceReady) await this._provenanceReady;
    await this._flushGrab();
    if (this._grabbing) await this._grabbing;
    const files = [
      { name: 'telemetry.json', data: new TextEncoder().encode(JSON.stringify(this.snapshot())) },
    ];
    for (let i = 0; i < this.markers.length; i++) {
      const blob = this._shots[i];
      const name = this.markers[i].screenshot;
      if (!blob || !name) continue;
      files.push({
        name,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    const tgz = await packTgz(files);
    const stamp = this.meta.startedAt.replace(/[:.]/g, '-');
    const filename = `cod-telemetry-${stamp}.tgz`;
    const url = URL.createObjectURL(new Blob([tgz], { type: 'application/gzip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout((): void => URL.revokeObjectURL(url), 1000);
    this.exported = true;
    this.badge.textContent = `EXPORTED ${filename}`;
    return { filename, bytes: tgz.byteLength, summary: this.summary() };
  }

  _afterRender(): void {
    if (!this._grabQueue.length) return;
    this._grabbing = this._flushGrab();
  }

  async _flushGrab(): Promise<void> {
    if (!this._grabQueue.length) return;
    const marks = this._grabQueue.splice(0);
    const blob = await this._captureJpeg();
    if (!blob) return;
    for (const mark of marks) {
      const i = this.markers.indexOf(mark);
      if (i < 0) continue;
      this._shots[i] = blob;
      mark.screenshot = shotName(i);
    }
  }

  _captureJpeg(): Promise<Blob | null> {
    const src = this.ctx.canvas;
    if (!src?.width || !src.height) return Promise.resolve(null);
    const w = Math.max(1, src.width >> 1);
    const h = Math.max(1, src.height >> 1);
    let off = this._offscreen;
    if (!off) {
      off = document.createElement('canvas');
      this._offscreen = off;
    }
    if (off.width !== w || off.height !== h) {
      off.width = w;
      off.height = h;
    }
    const context = off.getContext('2d');
    if (!context) return Promise.resolve(null);
    context.drawImage(src, 0, 0, w, h);
    return new Promise<Blob | null>((resolve): void => {
      off.toBlob((blob: Blob | null): void => resolve(blob), 'image/jpeg', 0.7);
    });
  }

  _buildNoteUi(): void {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'fixed',
      left: '50%',
      bottom: '36px',
      zIndex: '100001',
      transform: 'translateX(-50%)',
      display: 'none',
      padding: '6px 8px',
      color: '#d7f7ff',
      background: 'rgba(2,8,12,.9)',
      border: '1px solid rgba(90,210,255,.55)',
      borderRadius: '3px',
      font: '600 10px/1.2 ui-monospace,monospace',
      letterSpacing: '.06em',
    });
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 160;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'note · enter save';
    Object.assign(input.style, {
      width: '320px',
      border: '0',
      outline: 'none',
      background: 'transparent',
      color: '#d7f7ff',
      font: '600 11px/1.2 ui-monospace,monospace',
    });
    wrap.append(input);
    document.body.appendChild(wrap);
    this._note = wrap;
    this._noteInput = input;
  }

  _openNote(mark: TelemetryMark): void {
    if (this._noteMark) this._closeNote();
    this._noteMark = mark;
    const input = this.ctx.input;
    if (input) {
      this._restoreFrozen = input.frozen;
      this._restoreEnabled = input.enabled;
      input.frozen = true;
      input.enabled = false;
    }
    const player = this.ctx.peek('player');
    if (player) {
      this._restoreControl = player.controlEnabled;
      player.setControlEnabled?.(false);
    }
    this._noteInput.value = mark.note || '';
    this._note.style.display = '';
    queueMicrotask((): void => this._noteInput.focus());
  }

  _closeNote(): void {
    if (!this._noteMark) return;
    this._noteMark.note = this._noteInput.value.trim().slice(0, 160);
    this._noteMark = null;
    this._note.style.display = 'none';
    const input = this.ctx.input;
    if (input) {
      input.frozen = this._restoreFrozen ?? false;
      input.enabled = this._restoreEnabled ?? true;
    }
    this.ctx.peek('player')?.setControlEnabled?.(this._restoreControl ?? true);
    this._updateBadge(true);
  }

  _updateBadge(force = false): void {
    const raw = this._rawTime() as number;
    if (!force && raw - this._lastBadgeAt < 1) return;
    this._lastBadgeAt = raw;
    if (!this.recording) {
      this.badge.textContent = this.exported
        ? 'TELEMETRY EXPORTED'
        : 'TELEMETRY STOPPED · F8 EXPORT';
      return;
    }
    const hitches = this.hitches.length;
    this.badge.textContent = `● REC ${raw.toFixed(0)}s${hitches ? ` · ${hitches} HITCH${hitches === 1 ? '' : 'ES'}` : ''} · F7 MARK · F8 EXPORT`;
  }

  dispose(): void {
    this._nativeBuilds?.dispose();
    if (this._noteMark) {
      this._noteMark = null;
      this._note.style.display = 'none';
    }
    for (const off of this._off) off();
    this._off.length = 0;
    this._stopObservers();
    removeEventListener('visibilitychange', this._onVisibility);
    removeEventListener('keydown', this._onKey, true);
    removeEventListener('beforeunload', this._onBeforeUnload);
    this.badge?.remove();
    this._note?.remove();
    if (window.__TELEMETRY__ === this.api) delete window.__TELEMETRY__;
  }
}
