import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const refreshHashes = {
  'node_modules/three/src/nodes/lighting/ShadowBaseNode.js':
    '3764ffe7f9edef0fc33be8076f06398d16dbd9585c2cc62a7b1bc2c428cb7b54',
  'node_modules/three/src/materials/nodes/manager/NodeMaterialObserver.js':
    'c475caffca9f84bbb6727e16acb0eb4559619074ac8b29fc08a902d45e559b47',
  'node_modules/three/src/renderers/common/RenderObjects.js':
    'a3afa8c0c0e37f0430a14455efbaefbf5ad4f3ca3f59987aadb2f2968a5fc5e9',
};
const once = (s, before, after) => {
  assert.equal(s.split(before).length - 1, 1, `refresh source drift: ${before}`);
  return s.replace(before, after);
};

/** Exact-pin offline instrumentation. Predicate order/getter counts stay native. */
export function instrumentRefreshSources(sources) {
  const observer = 'node_modules/three/src/materials/nodes/manager/NodeMaterialObserver.js';
  const objects = 'node_modules/three/src/renderers/common/RenderObjects.js';
  for (const [path, hash] of Object.entries(refreshHashes))
    assert.equal(createHash('sha256').update(sources[path]).digest('hex'), hash, path);
  let s = sources[observer];
  const emit = 'globalThis.__REFRESH_CENSUS__?.emit';
  s = once(
    s,
    'this.renderId = 0;',
    `this.renderId = 0;\n\t\t${emit}( 'observer', this, builder );`
  );
  const start = s.indexOf('\tcontainsNode( builder ) {');
  const end = s.indexOf('\n\t/**', start);
  let body = s.slice(start, end);
  body = once(
    body,
    '\t\t\t\treturn true;',
    `\t\t\t\t{ ${emit}( 'cause', this, 'material:' + property ); return true; }`
  );
  const terms = ['modelViewMatrix', 'modelNormalViewMatrix', 'getAO', 'getShadow', 'getGI'];
  const old = terms.map((key) => `builder.context.${key}`).join(' || ');
  body = once(body, '\n\t\t// context\n', '\n\t\t// context\n\t\tlet censusContext;\n');
  body = once(
    body,
    old,
    terms.map((key) => `( builder.context.${key} && ( censusContext = '${key}' ) )`).join(' || ')
  );
  body = once(
    body,
    `if ( ${terms.map((key) => `( builder.context.${key} && ( censusContext = '${key}' ) )`).join(' || ')} )\n\t\t\treturn true;`,
    `if ( ${terms.map((key) => `( builder.context.${key} && ( censusContext = '${key}' ) )`).join(' || ')} )\n\t\t\t{ ${emit}( 'cause', this, 'context:' + censusContext ); return true; }`
  );
  body = once(
    body,
    'if ( material.fog === true && scene.fogNode && scene.fogNode.isNode )\n\t\t\treturn true;',
    `if ( material.fog === true && scene.fogNode && scene.fogNode.isNode )\n\t\t\t{ ${emit}( 'cause', this, 'scene:fogNode' ); return true; }`
  );
  body = once(
    body,
    'if ( scene.environmentNode && scene.environmentNode.isNode )\n\t\t\treturn true;',
    `if ( scene.environmentNode && scene.environmentNode.isNode )\n\t\t\t{ ${emit}( 'cause', this, 'scene:environmentNode' ); return true; }`
  );
  body = once(
    body,
    '\t\treturn false;',
    `\t\t${emit}( 'cause', this, 'none' );\n\t\treturn false;`
  );
  s = s.slice(0, start) + body + s.slice(end);
  const predicates = [
    ['this.hasNode', 'hasNode'],
    ['this.hasAnimation', 'animation'],
    ['this.hasDynamicInstancing( renderObject.object )', 'dynamicInstancing'],
    ['this.firstInitialization( renderObject )', 'firstInitialization'],
    ['this.needsVelocity( nodeFrame.renderer )', 'velocity'],
  ];
  s = once(
    s,
    `\t\tif ( ${predicates.map(([p]) => p).join(' || ')} )\n\t\t\treturn RenderObjectRefreshType.FULL;`,
    `\t\tlet censusReason;\n\t\tlet censusFlags = 0;\n\t\tif ( ${predicates.map(([p, why]) => `( ${p} && ( censusReason = '${why}' ) )`).join(' || ')} ) {\n\t\t\t${emit}( 'decision', this, renderObject, nodeFrame, RenderObjectRefreshType.FULL, censusReason, 0, 'early' );\n\t\t\treturn RenderObjectRefreshType.FULL;\n\t\t}`
  );
  s = once(s, 'this.renderId = renderId;', 'this.renderId = renderId;\n\t\t\tcensusFlags |= 1;');
  s = once(
    s,
    'renderObjectData.outputTarget = outputTarget;',
    'renderObjectData.outputTarget = outputTarget;\n\t\t\tcensusFlags |= 2;'
  );
  s = once(
    s,
    'if ( this.equals( renderObject, lightsData, renderId ) === false ) {',
    'if ( this.equals( renderObject, lightsData, renderId ) === false ) {\n\t\t\tcensusFlags |= 4;'
  );
  s = once(
    s,
    '\t\tif ( isStatic || isBundle )\n\t\t\treturn refreshType;',
    `\t\tif ( isStatic || isBundle ) {\n\t\t\t${emit}( 'decision', this, renderObject, nodeFrame, refreshType, '', censusFlags, 'static-or-bundle' );\n\t\t\treturn refreshType;\n\t\t}`
  );
  s = once(
    s,
    '\n\t\treturn refreshType;\n',
    `\n\t\t${emit}( 'decision', this, renderObject, nodeFrame, refreshType, '', censusFlags, 'fallback' );\n\t\treturn refreshType;\n`
  );
  sources[observer] = s;
  sources[objects] = once(
    sources[objects],
    '\n\t\trenderObject.onDispose = () => {',
    `\n\t\t${emit}( 'object', renderObject, passId );\n\n\t\trenderObject.onDispose = () => {`
  );
  return sources;
}

/** App-scoped pure RGB specialization; no native refresh-policy changes. */
export function shadowColorSources(sources, census = false) {
  if (census) sources = instrumentRefreshSources(sources);
  const path = 'src/materials/shader-tsl.ts';
  sources[path] = once(
    sources[path],
    "  mat.colorNode = channels.get('color');",
    `  const shadowRecord = mat as unknown as Record<string, unknown>;
  const shadowEligible = !p.alphaMask && !p.localSpace && !mat.transparent &&
    mat.opacity === 1 && mat.alphaTest === 0 && !mat.alphaHash && !mat.alphaToCoverage &&
    (shadowRecord.transmission ?? 0) === 0 &&
    ['map', 'alphaMap', 'opacityNode', 'alphaTestNode', 'castShadowNode', 'maskShadowNode',
     'maskNode', 'depthNode', 'positionNode', 'castShadowPositionNode', 'fragmentNode',
     'outputNode', 'vertexNode', 'contextNode', 'transmissionNode', 'lightsNode'].every(key => !shadowRecord[key]) &&
    [p.tileNode, p.tintNode, p.parallaxNode, p.normalAmpNode, p.groundNode, p.weatherNode].every(node =>
      node === undefined || typeof node === 'number' || (node as { isUniformNode?: boolean }).isUniformNode === true);
  mat.colorNode = shadowEligible ? Fn((_inputs: unknown, builder: NodeBuilder) =>
    (builder.material as { isShadowPassMaterial?: boolean }).isShadowPassMaterial === true
      ? vec3(0) : channels.get('color'), 'vec3')() : channels.get('color');`
  );
  return sources;
}

/** Causal prototype only: retain every other node/dynamic/velocity/equality check. */
export function shadowRefreshSources(sources, { census = false, ao = false } = {}) {
  if (census) sources = instrumentRefreshSources(sources);
  const observer = 'node_modules/three/src/materials/nodes/manager/NodeMaterialObserver.js';
  const shadow = 'node_modules/three/src/nodes/lighting/ShadowBaseNode.js';
  let s = sources[observer];
  s = once(
    s,
    'const refreshUniforms = [',
    'export const _constantShadowNodes = new WeakSet();\n\nconst refreshUniforms = ['
  );
  s = once(
    s,
    'const material = builder.material;',
    'const material = builder.material;\n\t\tconst constantDefaultShadow = material.isShadowPassMaterial === true && material.lights !== true && _constantShadowNodes.has( material.colorNode );'
  );
  s = once(
    s,
    'for ( const property in material ) {',
    "for ( const property in material ) {\n\t\t\tif ( property === 'colorNode' && constantDefaultShadow ) continue;"
  );
  if (ao)
    s = once(s, 'builder.context.getAO', '( ! constantDefaultShadow && builder.context.getAO )');
  sources[observer] = s;
  let sh = sources[shadow];
  sh =
    `import { _constantShadowNodes } from '../../materials/nodes/manager/NodeMaterialObserver.js';\n` +
    sh;
  sh = once(
    sh,
    'material.colorNode = vec4( 0, 0, 0, 1 );',
    'material.colorNode = vec4( 0, 0, 0, 1 );\n\t\t_constantShadowNodes.add( material.colorNode );'
  );
  sources[shadow] = sh;
  return sources;
}

/** Serialized before navigation. Collector failures never replace render errors. */
export function installRefreshCensus() {
  const metadata = new WeakMap(),
    passIds = new WeakMap(),
    ids = new WeakMap();
  const observers = [],
    specimens = new Map(),
    specimenMaterials = new Map(),
    rows = new Map(),
    passes = new Map(),
    frames = [],
    invocations = [],
    errors = [],
    restores = [];
  const sceneStack = [],
    objectStack = [];
  let nextId = 1,
    invocation = 0,
    current = null,
    renderer,
    ctx;
  const id = (object) => {
    if (object === null || object === undefined) return null;
    if (!ids.has(object)) ids.set(object, nextId++);
    return ids.get(object);
  };
  const safe = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (errors.length < 10) errors.push(String(e?.stack ?? e));
      return undefined;
    }
  };
  const describe = (o) => ({
    id: id(o),
    nativeId: o?.id ?? null,
    name: o?.name ?? '',
    type: o?.type ?? '',
  });
  const category = (ro) =>
    ro.object.userData?.owStatic
      ? ro.object.isInstancedMesh
        ? 'static-instanced'
        : 'static-mesh'
      : ro.object.isSkinnedMesh
        ? 'skinned'
        : ro.scene === ctx?.viewScene
          ? 'viewmodel'
          : ro.scene === ctx?.scene
            ? 'dynamic-world'
            : 'post-other';
  const makeRow = () => ({
    calls: 0,
    fullBindings: 0,
    sharedBindings: 0,
    groups: 0,
    bindings: 0,
    scopeChecks: 0,
    draws: 0,
    writes: 0,
    writeBytes: 0,
    updateNodeTypes: {},
    objects: new Set(),
    renderObjects: new Set(),
    observers: new Set(),
    groupsSeen: new Set(),
    invocations: new Set(),
  });
  const pass = (ro) => {
    const active = sceneStack.at(-1);
    const context = ro?.context ?? renderer?._currentRenderContext;
    const camera = ro?.camera ?? active?.camera;
    const scene = ro?.scene ?? active?.scene;
    const target = context?.renderTarget;
    const mrt = Object.keys(context?.mrt?.outputNodes ?? {})
      .sort()
      .join(',');
    const key = `${id(scene)}/${id(camera)}/${id(context)}/${id(target)}/${context?.activeCubeFace ?? 0}/${context?.activeMipmapLevel ?? 0}/${mrt}`;
    active?.record?.passKeys.add(key);
    if (!passes.has(key))
      passes.set(key, {
        key,
        scene: describe(scene),
        camera: describe(camera),
        context: context?.id ?? null,
        target: describe(target),
        mrt,
        depth: active?.depth ?? null,
        decisions: 0,
        draws: 0,
        writes: 0,
        bytes: 0,
        objects: new Set(),
        renderObjects: new Set(),
        invocations: new Set(),
        representative: active
          ? { invocation: active.id, parent: active.parent, frame: current.i }
          : null,
      });
    return passes.get(key);
  };
  const emit = (kind, owner, ...args) =>
    safe(() => {
      if (kind === 'cause') {
        metadata.set(owner, { id: id(owner), nodeCause: args[0] });
        return;
      }
      if (kind === 'observer') {
        const b = args[0];
        const source = b.renderer?._currentSourceMaterial;
        const shadowCache = source ? b.renderer?._cacheShadowNodes?.get(source) : null;
        const meta = metadata.get(owner) ?? { id: id(owner), nodeCause: 'unknown' };
        Object.assign(meta, {
          hasNode: owner.hasNode,
          animation: owner.hasAnimation,
          material: describe(b.material),
          objectAtBuild: describe(b.object),
          shadow: b.material.isShadowPassMaterial === true,
          sourceAtBuild: source
            ? {
                material: describe(source),
                derivedColor: shadowCache?.colorNode === b.material.colorNode,
                colorNodeType: source.colorNode?.nodeType ?? null,
                colorNodeClass: source.colorNode?.type ?? null,
                colorNode: source.colorNode?.isNode === true,
                opacityNode: source.opacityNode?.isNode === true,
                map: source.map?.isTexture === true,
                customCast: source.castShadowNode?.isNode === true,
                alphaTest: source.alphaTest,
              }
            : null,
          ownContextDataKeys: [
            'modelViewMatrix',
            'modelNormalViewMatrix',
            'getAO',
            'getShadow',
            'getGI',
          ].filter((key) => !!Object.getOwnPropertyDescriptor(b.context, key)?.value),
        });
        metadata.set(owner, meta);
        observers.push(meta);
        return;
      }
      if (kind === 'object') {
        passIds.set(owner, args[0] === undefined ? '<undefined>' : args[0]);
        return;
      }
      if (kind !== 'decision' || !current) return;
      const [ro, nodeFrame, type, reason, flags, exit] = args;
      const meta = metadata.get(owner),
        p = pass(ro);
      const source = ro._sourceMaterial ?? renderer._currentSourceMaterial ?? ro.material;
      const passId = passIds.has(ro) ? passIds.get(ro) : '<unknown>';
      const key = JSON.stringify([
        p.key,
        category(ro),
        id(ro.material),
        id(source),
        passId,
        type,
        reason,
        flags,
        exit,
        meta?.nodeCause ?? 'unknown',
      ]);
      if (!rows.has(key))
        rows.set(key, {
          ...makeRow(),
          pass: p.key,
          category: category(ro),
          material: describe(ro.material),
          sourceMaterial: describe(source),
          passId,
          type,
          reason: reason || null,
          flags,
          exit,
          nodeCause: meta?.nodeCause ?? 'unknown',
          shadow: meta?.shadow ?? false,
          representative: { frame: current.i, renderId: nodeFrame.renderId },
        });
      const row = rows.get(key);
      row.calls++;
      row.objects.add(id(ro.object));
      row.renderObjects.add(id(ro));
      row.observers.add(id(owner));
      row.groupsSeen.add(JSON.stringify(ro.group ?? null));
      if (sceneStack.length) {
        row.invocations.add(sceneStack.at(-1).id);
        p.invocations.add(sceneStack.at(-1).id);
      }
      p.decisions++;
      p.objects.add(id(ro.object));
      p.renderObjects.add(id(ro));
      current.decisions++;
      current.types[type] = (current.types[type] ?? 0) + 1;
      current.objects.add(id(ro.object));
      current.renderObjects.add(id(ro));
      if (!meta || passId === '<unknown>') current.unknown++;
      if (objectStack.length) objectStack.at(-1).row = row;
      else if (errors.length < 10)
        errors.push('decision outside _renderObjectDirect; bundle replay requires separate scope');
    });
  const wrap = (owner, key, before, after) => {
    const original = owner[key],
      owned = Object.hasOwn(owner, key);
    if (typeof original !== 'function') throw new Error(`missing census method ${key}`);
    const hooked = function (...args) {
      const token = safe(() => before?.(args));
      try {
        return original.apply(this, args);
      } finally {
        safe(() => after?.(args, token));
      }
    };
    owner[key] = hooked;
    restores.push(() => {
      if (owner[key] === hooked) {
        if (owned) owner[key] = original;
        else delete owner[key];
      }
    });
  };
  const row = () => (current ? objectStack.at(-1)?.row : null);
  const capture = (ro) => {
    if (!row() || !ro._bindings) return;
    const kind = category(ro),
      source = ro._sourceMaterial ?? ro.material;
    if (
      !kind.startsWith('static-') ||
      source.userData?.owParams?.alphaMask ||
      source.userData?.owParams?.localSpace !== false
    )
      return;
    if (!specimenMaterials.has(kind)) specimenMaterials.set(kind, source);
    if (specimenMaterials.get(kind) !== source) return;
    const key = `${kind}/${row().shadow ? 'shadow' : pass(ro).mrt ? 'prepass' : 'beauty'}`;
    if (specimens.has(key)) return;
    const state = ro._nodeBuilderState;
    specimens.set(key, {
      key,
      object: describe(ro.object),
      source: describe(source),
      material: describe(ro.material),
      vertexShader: state.vertexShader,
      fragmentShader: state.fragmentShader,
      updateNodes: state.updateNodes.map((node) => ({
        type: node.type,
        updateType: node.updateType,
      })),
      groups: ro._bindings.map((group) => ({
        name: group.name,
        bindings: group.bindings.map((binding) => ({
          name: binding.name,
          uniformBuffer: binding.isUniformBuffer === true,
          texture: binding.isSampledTexture === true,
          sampler: binding.isSampler === true,
          uniforms: binding.uniforms?.map((uniform) => uniform.name) ?? [],
        })),
      })),
    });
  };
  const api = {
    emit,
    frame(i) {
      if (current)
        frames.push({
          ...current,
          objects: current.objects.size,
          renderObjects: current.renderObjects.size,
        });
      current =
        i < 0
          ? null
          : {
              i,
              passCalls: 0,
              decisions: 0,
              draws: 0,
              writes: 0,
              writeBytes: 0,
              unknown: 0,
              types: {},
              objects: new Set(),
              renderObjects: new Set(),
            };
    },
    attach(r, context) {
      renderer = r;
      ctx = context;
      wrap(
        r,
        '_renderScene',
        (args) => {
          const token = {
            id: ++invocation,
            parent: sceneStack.at(-1)?.id ?? null,
            depth: sceneStack.length,
            scene: args[0],
            camera: args[1],
          };
          if (current) {
            current.passCalls++;
            token.record = {
              id: token.id,
              parent: token.parent,
              depth: token.depth,
              frame: current.i,
              scene: id(args[0]),
              camera: id(args[1]),
              passKeys: new Set(),
            };
            invocations.push(token.record);
          }
          sceneStack.push(token);
          return token;
        },
        () => {
          sceneStack.pop();
        }
      );
      wrap(
        r,
        '_renderObjectDirect',
        () => {
          objectStack.push({ row: null });
        },
        () => {
          objectStack.pop();
        }
      );
      for (const [method, field] of [
        ['updateForRender', 'fullBindings'],
        ['updateSharedForRender', 'sharedBindings'],
      ])
        wrap(
          r._bindings,
          method,
          () => {
            if (row()) row()[field]++;
          },
          ([ro]) => capture(ro)
        );
      wrap(r._bindings, '_update', ([group]) => {
        if (row()) {
          row().groups++;
          row().bindings += group.bindings.length;
        }
      });
      wrap(r._nodes, 'updateGroup', () => {
        if (row()) row().scopeChecks++;
      });
      wrap(r._nodes, 'updateForRender', ([ro]) => {
        if (!row()) return;
        for (const node of ro._nodeBuilderState.updateNodes) {
          const type = node.updateType;
          row().updateNodeTypes[type] = (row().updateNodeTypes[type] ?? 0) + 1;
        }
      });
      wrap(r.backend, 'draw', ([ro]) => {
        if (!current) return;
        current.draws++;
        pass(ro).draws++;
        if (row()) row().draws++;
      });
      wrap(r.backend.device.queue, 'writeBuffer', (args) => {
        if (!current) return;
        const data = args[2],
          scale = data.BYTES_PER_ELEMENT ?? 1;
        const bytes =
          args[4] === undefined ? data.byteLength - (args[3] ?? 0) * scale : args[4] * scale;
        current.writes++;
        current.writeBytes += bytes;
        const p = pass();
        p.writes++;
        p.bytes += bytes;
        if (row()) {
          row().writes++;
          row().writeBytes += bytes;
        }
      });
    },
    dispose() {
      for (const restore of restores.reverse()) restore();
      if (sceneStack.length || objectStack.length) errors.push('census stack not empty');
    },
    snapshot() {
      const flatten = (record) =>
        Object.fromEntries(
          Object.entries(record).map(([key, value]) => [
            key,
            value instanceof Set ? (key === 'invocations' ? value.size : Array.from(value)) : value,
          ])
        );
      return {
        note: 'Count-only invasive diagnostic; first-match native witnesses, later predicates NOT evaluated. No throughput claim or inclusive timing. Observer metadata captured before override restoration. flags: epoch=1,target=2,equalsFalse=4.',
        errors,
        observers,
        specimens: Array.from(specimens.values()),
        invocations: invocations.map(flatten),
        passes: Array.from(passes.values(), flatten),
        rows: Array.from(rows.values(), flatten),
        frames: frames.filter((f) => f.decisions || f.draws || f.writes),
      };
    },
  };
  globalThis.__REFRESH_CENSUS__ = api;
}
