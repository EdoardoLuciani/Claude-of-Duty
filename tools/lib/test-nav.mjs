// Mutable grid double for behaviour-only tests (which edit flags/floors by hand).
// Production nav/physics coverage lives in smoke-surface-nav and the map gate.
import * as THREE from 'three';
import { NavGrid as LegacyGrid } from '../nav240/legacy-nav.mjs';
export class NavGrid extends LegacyGrid {
  constructor(physics, opts) {
    super(physics, opts);
    this.components = new Map(); this._point = new THREE.Vector3();
  }
  _labelComponents() {
    this.components.clear();
    const queue = [];
    for (let start = 0; start < this.flags.length; start++) {
      if (!this.flags[start] || this.components.has(start + 1)) continue;
      queue.length = 0; queue.push(start); this.components.set(start + 1, start + 1);
      for (let k = 0; k < queue.length; k++) {
        const cur = queue[k], x = cur % this.nx, z = (cur / this.nx) | 0;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          if (!this.walkable(x + dx, z + dz)) continue;
          if (dx && dz && (!this.walkable(x + dx, z) || !this.walkable(x, z + dz))) continue;
          const next = this.index(x + dx, z + dz);
          if (this.components.has(next + 1) || Math.abs(this.floor[cur] - this.floor[next]) > this.maxStep) continue;
          this.components.set(next + 1, start + 1); queue.push(next);
        }
      }
    }
  }
  project(p, out) {
    if (![p.x, p.y, p.z].every(Number.isFinite)) return 0;
    const i = this.nearest(p.x, p.z, p.y, 8, 1.6);
    if (i < 0) return 0;
    out.set(this.worldX(i % this.nx), this.floor[i], this.worldZ((i / this.nx) | 0));
    this._labelComponents(); return i + 1;
  }
  sampleGround(x, z, y, out) { return this.project({ x, y, z }, out); }
  findPath(from, to, out) {
    this.startSurface = this.project(from, this._point); this.goalSurface = this.project(to, this._point);
    this.resolvedFloor = this.goalSurface ? this.floor[this.goalSurface - 1] : NaN;
    this.lastOutcome = 'invalid'; this.lastReason = 'attachment';
    if (!this.startSurface || !this.goalSurface) return 0;
    this.lastOutcome = 'unreachable'; this.lastReason = 'disconnected';
    if (this.components.get(this.startSurface) !== this.components.get(this.goalSurface)) return 0;
    const count = super.findPath(from, to, out);
    if (count) { this.lastOutcome = 'success'; this.lastReason = 'complete'; }
    return count;
  }
}
