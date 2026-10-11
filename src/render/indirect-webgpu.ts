import { EnvironmentNode, MeshStandardNodeMaterial, Vector3, Vector4 } from 'three/webgpu';
import type { Camera } from 'three';
import type { Node } from 'three/webgpu';
import type NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import { Break, Fn, If, Loop, abs, clamp, dot, float, max, min, mix, normalWorld,
  normalize, positionWorld, renderGroup, sharedUniformGroup, smoothstep, sqrt, uniform, uniformArray, vec3 } from 'three/tsl';

// Retained world indirect budget. Diffuse IBL is trimmed; world specular and
// clearcoat stay intact. The view path additionally applies local visibility.
const MAX_ROOMS = 10;
const SKY_FILL = 0.32;
const GROUND_FILL = 0.013;
const BOUNCE_FILL = 0.008;
const IBL_DIFFUSE = 0.030;
const INTERIOR_FLOOR = 0.035;

class IndirectEnvironmentNode extends EnvironmentNode {
  declare fill: IndirectFill; declare view: boolean;

  constructor(environment: Node, fill: IndirectFill, view: boolean) {
    super(environment);
    this.fill = fill;
    this.view = view;
  }

  setup(builder: NodeBuilder): ReturnType<EnvironmentNode['setup']> {
    super.setup(builder);
    const f = this.fill;
    const context = builder.context as unknown as LightingNodeContext;
    const ao = context.ambientOcclusion;
    const indoor = this.view ? f.viewVisibility : f.roomGate(positionWorld, ao);
    const up = clamp(normalWorld.y, -1, 1);
    const skyGate = smoothstep(-0.95, 0.85, up);
    const groundGate = smoothstep(-0.05, 0.7, up.negate());
    const fillAO = sqrt(max(ao, 0));
    const anti = normalize(vec3(f.sunDir.x.negate().add(1e-4), 0.28,
      f.sunDir.z.negate().add(1e-4)));
    const bounce = clamp(dot(normalWorld, anti).add(0.12).div(1.12), 0, 1);
    context.iblIrradiance.mulAssign(f.iblScale.mul(indoor));
    if (this.view) {
      // A coarse local-visibility proxy, including reflected sky. Unlike the
      // world-only gate, it must not leave a bright outdoor reflection indoors.
      context.radiance.mulAssign(indoor);
      context.lightingModel.clearcoatRadiance?.mulAssign(indoor);
    }
    context.irradiance.addAssign(f.sky.mul(skyGate)
      .add(f.ground.mul(groundGate.add(bounce.mul(BOUNCE_FILL / GROUND_FILL))))
      .mul(indoor).mul(fillAO));
    return;
  }
}

/** Live sky-driven, per-fragment two-band fill and coarse world-space room gate. */
interface IndirectContext { viewCamera: Camera; peek(id: 'world'): {
  buildings?: Array<{ spec?: { enterable?: boolean; collapse?: boolean; ruin?: boolean; x: number; z: number; w: number; d: number; setback?: { from?: number } } | null; roofY?: number; floorY?: number[] }>;
  levelToWorld?(x: number, y: number, z: number, out: Vector3): Vector3;
} | null }
interface IndirectSky { ambientColor?: { r: number; g: number; b: number }; indirectScale?: number }
interface IndirectLight { intensity: number; color: { r: number; g: number; b: number } }
type NodeValue<T extends string, V> = Node<T> & { value: V };
type UniformVec4Array = ReturnType<typeof uniformArray> & {
  element(index: Node<'int'>): Node<'vec4'>;
  value: unknown;
  update(): void;
};
interface LightingNodeContext { ambientOcclusion: Node<'float'>; iblIrradiance: Node<'vec3'>; radiance: Node<'vec3'>; irradiance: Node<'vec3'>; lightingModel: { clearcoatRadiance?: Node<'vec3'> } }
export class IndirectFill {
  declare ctx: IndirectContext; declare sky: NodeValue<'vec3', Vector3>; declare ground: NodeValue<'vec3', Vector3>; declare sunDir: NodeValue<'vec3', Vector3>;
  declare iblScale: NodeValue<'float', number>; declare viewVisibility: NodeValue<'float', number>; declare roomXf: NodeValue<'vec4', Vector4>; declare roomCount: NodeValue<'int', number>;
  declare rooms: Vector4[]; declare roomsY: Vector4[]; declare roomBoxes: UniformVec4Array; declare roomHeights: UniformVec4Array;
  declare roomGroup: ReturnType<typeof sharedUniformGroup>; declare _hue: Vector3; declare _ground: Vector3; declare _tmp: Vector3; declare _tmp2: Vector3;
  declare _patched: WeakSet<MeshStandardNodeMaterial>; declare _roomsReady: boolean;
  declare roomGate: (worldPos: Node<'vec3'>, ao: Node<'float'>) => Node<'float'>;

  constructor(ctx: IndirectContext) {
    this.ctx = ctx;
    // The custom environment hook is not a material node property, so rigid
    // unchanged meshes can receive only SHARED refreshes. These genuinely
    // per-render fields must live in a shared render group, not object uniforms.
    // Reuse the native group: no extra bind group or identity color-node hack.
    this.sky = uniform(new Vector3()).setGroup(renderGroup);
    this.ground = uniform(new Vector3()).setGroup(renderGroup);
    this.sunDir = uniform(new Vector3(0, 1, 0)).setGroup(renderGroup);
    this.iblScale = uniform(IBL_DIFFUSE).setGroup(renderGroup);
    this.viewVisibility = uniform(1).setGroup(renderGroup);
    this.roomXf = uniform(new Vector4(1, 0, 0, 0));
    this.roomCount = uniform(0, 'int');
    this.rooms = Array.from({ length: MAX_ROOMS }, () => new Vector4());
    this.roomsY = Array.from({ length: MAX_ROOMS }, () => new Vector4());
    this.roomBoxes = uniformArray(this.rooms, 'vec4') as unknown as UniformVec4Array;
    this.roomHeights = uniformArray(this.roomsY, 'vec4') as unknown as UniformVec4Array;
    // Node updateType stops CPU packing; a shared immutable binding group also
    // prevents per-object GPU uploads. Publish once when world data is ready.
    this.roomGroup = sharedUniformGroup('owRooms', 1, 'none');
    this.roomBoxes.setGroup(this.roomGroup);
    this.roomHeights.setGroup(this.roomGroup);
    this.roomBoxes.updateType = 'none';
    this.roomHeights.updateType = 'none';
    this._hue = new Vector3();
    this._ground = new Vector3();
    this._tmp = new Vector3();
    this._tmp2 = new Vector3();
    this._patched = new WeakSet();
    this.roomGate = Fn<[Node<'vec3'>, Node<'float'>], Node<'float'>>(([worldPos, ao]) => {
      const lx = worldPos.x.mul(this.roomXf.x).add(worldPos.z.mul(this.roomXf.y)).add(this.roomXf.z);
      const lz = worldPos.z.mul(this.roomXf.x).sub(worldPos.x.mul(this.roomXf.y)).add(this.roomXf.w);
      const indoor = float(0).toVar();
      Loop(MAX_ROOMS, ({ i }) => {
        If(i.greaterThanEqual(this.roomCount), () => { Break(); });
        const r = this.roomBoxes.element(i) as unknown as Node<'vec4'>, ry = this.roomHeights.element(i) as unknown as Node<'vec4'>;
        const dx = r.z.sub(abs(lx.sub(r.x))), dz = r.w.sub(abs(lz.sub(r.y)));
        const dy = min(worldPos.y.sub(ry.x), ry.y.sub(worldPos.y));
        indoor.assign(max(indoor, smoothstep(0.06, 0.30, min(min(dx, dz), dy))));
      });
      const aoGate = mix(1, smoothstep(0.45, 0.98, ao), 0.6);
      return mix(INTERIOR_FLOOR, 1, clamp(min(float(1).sub(indoor), aoGate), 0, 1));
    }) as unknown as typeof this.roomGate;
  }

  patch(material: MeshStandardNodeMaterial | null | undefined): void {
    if (!material?.isMeshStandardNodeMaterial || this._patched.has(material)) return;
    if (material.userData?.owNoPatch) return;
    this._patched.add(material);
    const original = material.setupEnvironment.bind(material);
    const viewCamera = this.ctx.viewCamera;
    const wrapEnvironment = (node: Node, view: boolean) => new IndirectEnvironmentNode(node, this, view);
    // NodeMaterial's public lighting hook: preserve the actual environment
    // sampling and add diffuse-only fill in the same PBR lighting context.
    material.setupEnvironment = function (builder: NodeBuilder) {
      const env = original(builder);
      // Shared library materials can appear in BOTH passes. Viewmodel prewarm
      // compiles them in a temporary scene, but always with the view camera.
      return env instanceof EnvironmentNode
        ? wrapEnvironment(env.envNode as Node, (builder as NodeBuilder & { camera: Camera }).camera === viewCamera) : env;
    };
    material.needsUpdate = true; // also correct materials compiled before they were registered
  }

  update(light: IndirectLight, sky?: IndirectSky): void {
    const hue = this._hue;
    const ambient = sky?.ambientColor;
    let level;
    if (ambient && Math.max(ambient.r, ambient.g, ambient.b) > 1e-5) {
      hue.set(ambient.r, ambient.g, ambient.b);
      level = Math.max(hue.x, hue.y, hue.z);
    } else {
      hue.set(0.36, 0.56, 1);
      level = 0.15 * light.intensity;
    }
    hue.divideScalar(Math.max(hue.x, hue.y, hue.z));
    const l = hue.x * 0.2126 + hue.y * 0.7152 + hue.z * 0.0722;
    hue.set(Math.max(0, l + (hue.x - l) * 1.18),
      Math.max(0, l + (hue.y - l) * 1.18),
      Math.max(0, l + (hue.z - l) * 1.18));
    hue.divideScalar(Math.max(hue.x, hue.y, hue.z, 1e-6));
    this.sky.value.copy(hue).multiplyScalar(SKY_FILL * level / 0.15);
    const c = light.color;
    const ground = this._ground.set(c.r * 0.33, c.g * 0.29, c.b * 0.225);
    ground.divideScalar(Math.max(ground.x, ground.y, ground.z, 1e-6));
    this.ground.value.copy(ground).multiplyScalar(GROUND_FILL * light.intensity);
    this.iblScale.value = IBL_DIFFUSE * (sky?.indirectScale ?? 1);
    this._updateRooms();
  }

  _updateRooms(): void {
    if (this._roomsReady) return;
    const world = this.ctx.peek('world');
    if (!world?.buildings || !world.levelToWorld) return;
    const origin = world.levelToWorld(0, 0, 0, this._tmp);
    const ox = origin.x, oz = origin.z;
    const axis = world.levelToWorld(1, 0, 0, this._tmp2);
    const dx = axis.x - ox, dz = axis.z - oz;
    const inv = 1 / Math.max(1e-6, Math.hypot(dx, dz));
    const cs = dx * inv, sn = dz * inv;
    this.roomXf.value.set(cs, sn, -(ox * cs + oz * sn), ox * sn - oz * cs);
    let count = 0;
    for (const building of world.buildings) {
      const sp = building?.spec;
      if (!sp?.enterable || sp.collapse || sp.ruin) continue;
      if (count === MAX_ROOMS) break;
      this.rooms[count].set(sp.x, sp.z, sp.w * 0.5, sp.d * 0.5);
      let top = (building.roofY ?? 12) - 0.06;
      const sb = sp.setback?.from;
      if (sb !== undefined && building.floorY?.[sb] !== undefined)
        top = building.floorY[sb] - 0.06;
      this.roomsY[count].set(-0.8, top, 0, 0);
      count++;
    }
    this.roomCount.value = count;
    // Usually shader setup follows this call. Also handle an already-compiled
    // early variant: pack its allocated arrays and invalidate the binding once.
    if (this.roomBoxes.value) this.roomBoxes.update();
    if (this.roomHeights.value) this.roomHeights.update();
    this.roomGroup.needsUpdate = true;
    this._roomsReady = true;
    console.info(`[render] indirect gate: ${count} interior volumes`);
  }
}
