// Versioned, checked envelope around the pinned 32-bit Detour tile-set format.
// Kept separate from the WASM module so invalid assets fail before native import.
import { isRecord, isNumberArray } from './validation.ts';
import { INFANTRY } from './capabilities.ts';
import { LADDER, LADDER_MOTOR_VERSION, type LadderDescriptor } from './ladder.ts';
export const NAV_VERSION = 2;
export const NAV_LADDER_FLAG = 2, NAV_LINK_RADIUS = .7;
export const NAV_ENGINE = 'recast-navigation@0.43.1';
export const NAV_PROFILE = Object.freeze({ radius: INFANTRY.navRadius,
  height: INFANTRY.height * INFANTRY.maxScale, crouchHeight: INFANTRY.crouchHeight * INFANTRY.maxScale,
  step: INFANTRY.stepHeight, slope: INFANTRY.slopeDegrees, stance: 'standing' });
export const NAV_CONFIG = Object.freeze({ cs: .045, ch: .05, tileSize: 256,
  walkableSlopeAngle: NAV_PROFILE.slope, walkableHeight: Math.ceil(NAV_PROFILE.height / .05),
  walkableClimb: Math.floor(NAV_PROFILE.step / .05), walkableRadius: Math.ceil(NAV_PROFILE.radius / .045),
  minRegionArea: 0, mergeRegionArea: 0, maxSimplificationError: 1, detailSampleDist: 1, detailSampleMaxError: 1 });
const MAGIC = 'OWSURF02', HEADER = 64, MAX_BYTES = 64 * 1024 * 1024;
type ByteInput = ArrayBuffer | ArrayBufferView;
export interface CoverPoint { x: number; y: number; z: number; dx: number; dz: number; dist: number; surface: number; high: boolean; claimed: number }
export interface BakedCoverPoint extends CoverPoint { component: number }
export interface NavMetadata {
  version?: number; engine?: string; profile?: typeof NAV_PROFILE; config?: typeof NAV_CONFIG;
  bounds: { min: number[]; max: number[] }; sourceHash?: string; collisionAsset?: string;
  ladderMotorVersion?: number; ladders?: readonly LadderDescriptor[];
}
export interface ExpectedNav { sha256?: string; sourceHash?: string; collisionAsset?: string; ladders?: readonly LadderDescriptor[] }
const bytes = (b: ByteInput): Uint8Array => b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const check = (ok: unknown, why: string): void => { if (!ok) throw new Error(`[nav] ${why}`); };
export async function navHash(buffer: ByteInput): Promise<string> {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes(buffer)).buffer)),
    b => b.toString(16).padStart(2, '0')).join('');
}


// Full-precision motor geometry is authoritative; native endpoints are float32
// topology only. Do not recover motor coordinates from Detour vertices.
function checkedLadders(value: unknown, bounds: NavMetadata['bounds']): readonly LadderDescriptor[] {
  check(Array.isArray(value) && value.length <= 1024, 'invalid ladder descriptors');
  return Object.freeze((value as unknown[]).map((v, i) => {
    if (!isRecord(v) || v.id !== i + 1 || v.volumeIndex !== i || typeof v.radius !== 'number'
      || !Number.isFinite(v.radius) || v.radius <= 0 || v.radius > 2 || !isRecord(v.normal)
      || !Array.isArray(v.points) || v.points.length !== 4) throw new Error('[nav] invalid ladder descriptor');
    const point = (p: unknown): { x: number; y: number; z: number } => {
      if (!isRecord(p) || ![p.x, p.y, p.z].every(n => typeof n === 'number' && Number.isFinite(n))) throw new Error('[nav] invalid ladder point');
      return { x: p.x as number, y: p.y as number, z: p.z as number };
    };
    const normal = point(v.normal), points = v.points.map(point) as unknown as LadderDescriptor['points'];
    const [lower, bottom, top, upper] = points;
    check(normal.y === 0 && Math.abs(Math.hypot(normal.x, normal.z) - 1) <= 1e-6
      && lower.y === bottom.y && top.y === upper.y && bottom.x === top.x && bottom.z === top.z
      && top.y > bottom.y && top.y - bottom.y <= 12
      && lower.x === bottom.x + normal.x * LADDER.lowerOffset && lower.z === bottom.z + normal.z * LADDER.lowerOffset
      && upper.x === top.x + normal.x * LADDER.upperOffset && upper.z === top.z + normal.z * LADDER.upperOffset,
    'invalid ladder geometry');
    for (let k = 0; k < 3; k++) {
      const span = Math.hypot(points[k + 1].x - points[k].x, points[k + 1].y - points[k].y, points[k + 1].z - points[k].z);
      check(Number.isFinite(span) && span > 0, 'invalid ladder span');
    }
    for (const p of points) for (const [axis, n] of [p.x, p.y, p.z].entries()) {
      check(n >= bounds.min[axis] && n <= bounds.max[axis], 'ladder outside bounds');
    }
    return Object.freeze({ id: i + 1, volumeIndex: i, normal: Object.freeze(normal), radius: v.radius,
      points: Object.freeze(points.map(Object.freeze)) as LadderDescriptor['points'] });
  }));
}

// The upstream importer uses unchecked memcpy. Check every tile's byte extent
// and allocation counts ourselves, not just the outer file length.
function validateTiles(b: Uint8Array, ladders: readonly LadderDescriptor[]): Map<number, boolean> {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  check(b.length >= 40 && d.getUint32(0, true) === 0x4d534554 && d.getUint32(4, true) === 1, 'unsupported Detour tile set');
  const count = d.getUint32(8, true), maxTiles = d.getUint32(32, true), maxPolys = d.getUint32(36, true);
  check(count > 0 && count <= maxTiles && maxTiles <= 16384 && maxPolys > 0 && maxPolys <= (1 << 22), 'invalid tile capacity');
  const tileBits = Math.ceil(Math.log2(maxTiles)), polyBits = Math.ceil(Math.log2(maxPolys));
  check(tileBits + polyBits <= 22, 'insufficient reference salt bits');
  for (let i = 12; i <= 28; i += 4) check(Number.isFinite(d.getFloat32(i, true)), 'invalid nav origin/dimensions');
  check(d.getFloat32(24, true) > 0 && d.getFloat32(28, true) > 0, 'invalid tile dimensions');
  let offset = 40;
  const refs = new Set(), surfaces = new Map<number, boolean>(), ids = new Set<number>();
  for (let i = 0; i < count; i++) {
    check(offset + 108 <= b.length, 'truncated tile header');
    const ref = d.getUint32(offset, true), length = d.getUint32(offset + 4, true);
    check(ref > 0 && !refs.has(ref), 'invalid/duplicate tile reference'); refs.add(ref);
    check((ref & ((1 << polyBits) - 1)) === 0 && ((ref >>> polyBits) & ((1 << tileBits) - 1)) < maxTiles
      && (ref >>> (polyBits + tileBits)) > 0, 'invalid tile reference bits');
    offset += 8;
    check(length >= 100 && offset + length <= b.length, 'truncated tile data');
    const at = (n: number): number => d.getUint32(offset + n, true);
    check(at(0) === 0x444e4156 && at(4) === 7, 'unsupported Detour tile version');
    const n = at(24), v = at(28), links = at(32), detail = at(36), dv = at(40), dt = at(44), bv = at(48), off = at(52);
    check(n > 0 && n <= maxPolys && v >= 3 && v <= 65535 && detail === n - off && off <= n && at(56) === detail, 'invalid ground/offmesh tile counts');
    check(100 + v * 12 + n * 32 + links * 12 + detail * 12 + dv * 12 + dt * 4 + bv * 16 + off * 36 === length, 'tile section lengths disagree');
    for (let k = 60; k <= 96; k += 4) check(Number.isFinite(d.getFloat32(offset + k, true)), 'nonfinite tile bounds/profile');
    for (let k = 0; k < 3; k++) check(d.getFloat32(offset + 72 + k * 4, true) <= d.getFloat32(offset + 84 + k * 4, true), 'inverted tile bounds');
    const profile = [NAV_CONFIG.walkableHeight * NAV_CONFIG.ch, NAV_CONFIG.walkableRadius * NAV_CONFIG.cs, NAV_CONFIG.walkableClimb * NAV_CONFIG.ch];
    for (let k = 0; k < 3; k++) check(Math.abs(d.getFloat32(offset + 60 + k * 4, true) - profile[k]) < 1e-5, 'incompatible tile profile');
    check(d.getFloat32(offset + 96, true) > 0, 'invalid BV quantization');
    for (let k = 0; k < v * 3; k++) check(Number.isFinite(d.getFloat32(offset + 100 + k * 4, true)), 'nonfinite vertex');
    const polyOffset = offset + 100 + v * 12;
    const detailOffset = polyOffset + n * 32 + links * 12;
    const detailVerts = detailOffset + detail * 12, detailTris = detailVerts + dv * 12;
    for (let k = 0; k < dv * 3; k++) check(Number.isFinite(d.getFloat32(detailVerts + k * 4, true)), 'nonfinite detail vertex');
    for (let p = 0; p < n; p++) {
      const atPoly = polyOffset + p * 32, nv = d.getUint8(atPoly + 30);
      const walking = p < detail; surfaces.set(ref + p, walking);
      check(walking ? nv >= 3 && nv <= 6 && d.getUint8(atPoly + 31) === 0 && d.getUint16(atPoly + 28, true) === 1
        : nv === 2 && d.getUint8(atPoly + 31) === 64 && d.getUint16(atPoly + 28, true) === NAV_LADDER_FLAG, 'invalid polygon type/flags');
      for (let k = 0; k < nv; k++) {
        check(d.getUint16(atPoly + 4 + k * 2, true) < v, 'invalid polygon vertex');
        const neighbour = d.getUint16(atPoly + 16 + k * 2, true);
        check(neighbour & 0x8000 ? (neighbour & 0x7fff) < 8 : neighbour <= detail, 'invalid polygon neighbour');
      }
      if (!walking) {
        for (let k = 0; k < 6; k++) check(d.getUint16(atPoly + 16 + k * 2, true) === 0, 'invalid offmesh neighbour');
        continue;
      }
      const sub = detailOffset + p * 12, vb = d.getUint32(sub, true), tb = d.getUint32(sub + 4, true);
      const vc = d.getUint8(sub + 8), tc = d.getUint8(sub + 9);
      check(vb + vc <= dv && tb + tc <= dt, 'invalid detail ranges');
      for (let t = tb; t < tb + tc; t++) for (let k = 0; k < 3; k++) check(d.getUint8(detailTris + t * 4 + k) < nv + vc, 'invalid detail triangle');
    }
    for (let k = 0; k < bv; k++) {
      const node = detailTris + dt * 4 + k * 16, index = d.getInt32(node + 12, true);
      check(index >= 0 ? index < detail : k - index <= bv, 'invalid BV node');
      for (let axis = 0; axis < 3; axis++) check(d.getUint16(node + axis * 2, true) <= d.getUint16(node + 6 + axis * 2, true), 'inverted BV bounds');
    }
    const offOffset = detailTris + dt * 4 + bv * 16;
    for (let k = 0; k < off; k++) {
      const o = offOffset + k * 36, id = d.getUint32(o + 32, true), descriptor = ladders[id - 1];
      check(descriptor && !ids.has(id), 'unknown/duplicate ladder connection'); ids.add(id);
      check(d.getUint16(o + 28, true) === detail + k && d.getUint8(o + 30) === 1
        && (d.getUint8(o + 31) === 255 || d.getUint8(o + 31) < 8), 'invalid offmesh index/direction/side');
      check(d.getFloat32(o + 24, true) === Math.fround(NAV_LINK_RADIUS), 'invalid offmesh radius');
      for (const [end, point] of [descriptor.points[0], descriptor.points[3]].entries()) {
        const vertex = d.getUint16(polyOffset + (detail + k) * 32 + 4 + end * 2, true);
        for (const [axis, n] of [point.x, point.y, point.z].entries()) {
          check(d.getFloat32(o + end * 12 + axis * 4, true) === Math.fround(n), 'offmesh descriptor endpoint mismatch');
          // Exported vertices have been projected to attached ground by Detour.
          const actual = d.getFloat32(offset + 100 + vertex * 12 + axis * 4, true);
          check(Math.abs(actual - n) <= (axis === 1 ? NAV_PROFILE.step : NAV_LINK_RADIUS), 'offmesh vertex outside attachment bounds');
        }
      }
    }
    offset += length;
  }
  check(offset === b.length, 'trailing tile bytes');
  check(ids.size === ladders.length, 'missing ladder connection');
  return surfaces;
}

export async function packNav(metadata: NavMetadata, navBytes: ByteInput, components: Map<number, number>, points: readonly CoverPoint[]): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify({ ...metadata, version: NAV_VERSION, engine: NAV_ENGINE, profile: NAV_PROFILE, ladderMotorVersion: LADDER_MOTOR_VERSION, ladders: metadata.ladders ?? [] }));
  const jsonSize = (json.length + 3) & ~3;
  const nav = bytes(navBytes), compSize = components.size * 8, coverSize = points.length * 32;
  const out = new Uint8Array(HEADER + jsonSize + nav.length + compSize + coverSize);
  const d = new DataView(out.buffer);
  out.set(new TextEncoder().encode(MAGIC));
  d.setUint32(8, jsonSize, true); d.setUint32(12, nav.length, true);
  d.setUint32(16, components.size, true); d.setUint32(20, points.length, true);
  out.fill(32, HEADER, HEADER + jsonSize); out.set(json, HEADER); out.set(nav, HEADER + jsonSize);
  let offset = HEADER + jsonSize + nav.length;
  for (const [ref, component] of components) {
    d.setUint32(offset, ref, true); d.setUint32(offset + 4, component, true); offset += 8;
  }
  for (const p of points) {
    for (const [k, value] of [p.x, p.y, p.z, p.dx, p.dz, p.dist].entries()) d.setFloat32(offset + k * 4, value, true);
    d.setUint32(offset + 24, p.surface, true); d.setUint32(offset + 28, p.high ? 1 : 0, true); offset += 32;
  }
  out.set(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', out.subarray(HEADER))), 32);
  return out;
}

export async function unpackNav(buffer: ByteInput, expected: ExpectedNav = {}): Promise<{ meta: NavMetadata; nav: Uint8Array; components: Map<number, number>; points: BakedCoverPoint[] }> {
  const b = bytes(buffer);
  check(b.length >= HEADER && b.length <= MAX_BYTES, 'invalid bake size');
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  check(new TextDecoder().decode(b.subarray(0, 8)) === MAGIC, 'unsupported bake magic');
  check(d.getUint32(24, true) === 0 && d.getUint32(28, true) === 0, 'unsupported reserved flags');
  const jsonSize = d.getUint32(8, true), navSize = d.getUint32(12, true), count = d.getUint32(16, true), coverCount = d.getUint32(20, true);
  check(jsonSize > 0 && jsonSize <= 65536 && jsonSize % 4 === 0 && navSize % 4 === 0 && count > 0, 'invalid section sizes');
  check(HEADER + jsonSize + navSize + count * 8 + coverCount * 32 === b.length, 'bake lengths disagree');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(b.subarray(HEADER)).buffer));
  check(digest.every((v, i) => v === b[32 + i]), 'bake checksum mismatch');
  if (expected.sha256) check(await navHash(b) === expected.sha256, 'manifest nav hash mismatch');
  const value: unknown = JSON.parse(new TextDecoder().decode(b.subarray(HEADER, HEADER + jsonSize)));
  if (!isRecord(value) || !isRecord(value.bounds) || !isNumberArray(value.bounds.min) || !isNumberArray(value.bounds.max)) {
    throw new Error('[nav] missing bounds');
  }
  if (value.version !== NAV_VERSION || value.engine !== NAV_ENGINE) throw new Error('[nav] unsupported bake version/engine');
  if (JSON.stringify(value.profile) !== JSON.stringify(NAV_PROFILE)) throw new Error('[nav] incompatible infantry profile');
  if (JSON.stringify(value.config) !== JSON.stringify(NAV_CONFIG)) throw new Error('[nav] incompatible bake configuration');
  for (const key of ['sourceHash', 'collisionAsset']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(`[nav] invalid ${key}`);
  }
  const meta: NavMetadata = { ...value, version: value.version, engine: value.engine,
    profile: NAV_PROFILE, config: NAV_CONFIG, bounds: { min: value.bounds.min, max: value.bounds.max },
    sourceHash: typeof value.sourceHash === 'string' ? value.sourceHash : undefined,
    collisionAsset: typeof value.collisionAsset === 'string' ? value.collisionAsset : undefined };
  check(meta.version === NAV_VERSION && meta.engine === NAV_ENGINE, 'unsupported bake version/engine');
  check(JSON.stringify(meta.profile) === JSON.stringify(NAV_PROFILE), 'incompatible infantry profile');
  check(JSON.stringify(meta.config) === JSON.stringify(NAV_CONFIG), 'incompatible bake configuration');
  check(Array.isArray(meta.bounds?.min) && Array.isArray(meta.bounds?.max) && meta.bounds.min.length === 3 && meta.bounds.max.length === 3, 'missing bounds');
  for (let k = 0; k < 3; k++) check(Number.isFinite(meta.bounds.min[k]) && Number.isFinite(meta.bounds.max[k]) && meta.bounds.min[k] <= meta.bounds.max[k], 'invalid bounds');
  for (const key of ['sourceHash', 'collisionAsset'] as const) if (expected[key] !== undefined) check(meta[key] === expected[key], `${key} mismatch`);
  check(value.ladderMotorVersion === LADDER_MOTOR_VERSION, 'incompatible ladder motor');
  meta.ladders = checkedLadders(value.ladders, meta.bounds); meta.ladderMotorVersion = LADDER_MOTOR_VERSION;
  if (expected.ladders) check(JSON.stringify(meta.ladders) === JSON.stringify(expected.ladders), 'authored ladder binding mismatch');
  const nav = b.slice(HEADER + jsonSize, HEADER + jsonSize + navSize);
  const surfaces = validateTiles(nav, meta.ladders);
  check(surfaces.size === count, 'polygon count mismatch');
  const components = new Map<number, number>();
  let offset = HEADER + jsonSize + navSize;
  for (let i = 0; i < count; i++, offset += 8) {
    const ref = d.getUint32(offset, true), component = d.getUint32(offset + 4, true);
    check(ref > 0 && component > 0 && component <= count && !components.has(ref) && surfaces.has(ref), 'invalid surface/component');
    components.set(ref, component);
  }
  const points: BakedCoverPoint[] = [];
  for (let i = 0; i < coverCount; i++, offset += 32) {
    const p: BakedCoverPoint = { x: d.getFloat32(offset, true), y: d.getFloat32(offset + 4, true), z: d.getFloat32(offset + 8, true),
      dx: d.getFloat32(offset + 12, true), dz: d.getFloat32(offset + 16, true), dist: d.getFloat32(offset + 20, true),
      surface: d.getUint32(offset + 24, true), high: d.getUint32(offset + 28, true) === 1, claimed: -1,
      component: components.get(d.getUint32(offset + 24, true))! };
    check([p.x, p.y, p.z, p.dx, p.dz, p.dist].every(Number.isFinite) && p.dist >= 0 && surfaces.get(p.surface) === true, 'invalid cover point');
    check(d.getUint32(offset + 28, true) <= 1, 'invalid cover flags');
    check(Math.abs(Math.hypot(p.dx, p.dz) - 1) < .001, 'invalid cover direction');
    for (const [k, value] of [p.x, p.y, p.z].entries()) check(value >= meta.bounds.min[k] - NAV_CONFIG.ch && value <= meta.bounds.max[k] + NAV_CONFIG.ch, 'cover outside bounds');
    points.push(p);
  }
  return { meta, nav, components, points };
}
