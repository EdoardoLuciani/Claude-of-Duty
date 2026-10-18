/** Offline-only experiments for the exact Three.js pin. Not imported by runtime. */
import assert from 'node:assert/strict';

import {
  instrumentRefreshSources,
  refreshHashes,
  shadowRefreshSources,
  shadowColorSources,
} from './refresh-census.mjs';

const bindings = 'node_modules/three/src/renderers/common/Bindings.js';
const renderObject = 'node_modules/three/src/renderers/common/RenderObject.js';
const uniforms = 'node_modules/three/src/renderers/common/Uniform.js';
const group = 'node_modules/three/src/renderers/common/UniformsGroup.js';
const materials = 'src/materials/index.ts';
export const pristineHashes = {
  ...refreshHashes,
  'src/materials/shader-tsl.ts': 'd8070e169bdc03655c9dfbad4a7b82a98fa6abdd1992845d11eb11bc58af0ac0',
  [bindings]: 'fc013766c37e8609787893bc959afb099787584bd4bbd3d172d331aa4f64140d',
  [renderObject]: '8b423e148a2f4293d9c06cad8cd7c93a56d393527a22942a3122da4a2b5cd466',
  [uniforms]: 'ae9852a3e4f8b3c5a7c5dce1c81c207ade66f307273778371344e7b825a8e079',
  [group]: '188f4e64e693ccfa04c810b4ad405312b01220a072b3698af06909bf9600c51c',
  [materials]: 'ace6672f028716c3c2166001599643604508a7ca8c208944f3f18430857cdace',
};
const replace = (source, before, after) => {
  assert.equal(source.split(before).length - 1, 1, `source drift: ${before}`);
  return source.replace(before, after);
};
export const trialNames = [
  'base',
  'refresh-census',
  'shadow-color',
  'shadow-color-census',
  'shadow-constant',
  'shadow-constant-census',
  'shadow-unlit-ao',
  'shadow-unlit-ao-census',
  'lazy-key',
  'group-epoch',
  'hoist-scope',
  'fused-bindings',
  'lazy-resources',
  'init-field',
  'uniform-kind',
  'binding-kind',
  'index-loops',
  'local-loops',
  'loop-groups',
  'loop-bindings',
  'loop-uniforms',
  'material-scope',
];
export function cpuSubmissionTrial(sources, name) {
  // '+' combinations are explicit experiments, never silently enabled variants.
  for (const trial of name.split('+')) {
    assert(trialNames.includes(trial), `unknown trial ${trial}`);
    if (trial === 'base') continue;
    if (trial === 'refresh-census') {
      sources = instrumentRefreshSources(sources);
    } else if (trial === 'shadow-color' || trial === 'shadow-color-census') {
      sources = shadowColorSources(sources, trial.endsWith('-census'));
    } else if (trial.startsWith('shadow-')) {
      sources = shadowRefreshSources(sources, {
        census: trial.endsWith('-census'),
        ao: trial.startsWith('shadow-unlit-ao'),
      });
    } else if (trial === 'lazy-key' || trial === 'lazy-resources') {
      let s = sources[bindings];
      s = replace(
        s,
        "\n\t\tlet cacheBindings = true;\n\t\tlet cacheKey = '';\n\t\tlet version = 0;\n",
        '\n'
      );
      s = replace(
        s,
        "\n\t\t\t\tcacheKey += attribute.id + ',';\n\t\t\t\tversion += generation;\n",
        '\n'
      );
      const start = s.indexOf(
        '\n\t\t\t\tconst textureData = backend.get( texture );',
        s.indexOf('\n\t_update( bindGroup, bindings )')
      );
      const end = s.indexOf('\n\t\t\t\tif ( texture.isStorageTexture', start);
      assert(start > 0 && end > start);
      s = s.slice(0, start) + '\n' + s.slice(end);
      s = replace(
        s,
        "\t\t\tthis.backend.updateBindings( bindGroup, bindings, cacheBindings ? cacheKey : '', version );",
        `\t\t\t// Build the complete resource key only when a native bind group changes.
\t\t\tlet cacheBindings = true;
\t\t\tlet cacheKey = '';
\t\t\tlet version = 0;
\t\t\tfor ( const binding of bindGroup.bindings ) {
\t\t\t\tif ( binding.isStorageBuffer ) {
\t\t\t\t\tcacheKey += binding.attribute.id + ',';
\t\t\t\t\tversion += this.attributes.get( binding.attribute ).generation;
\t\t\t\t} else if ( binding.isSampledTexture ) {
\t\t\t\t\tconst texture = binding.texture;
\t\t\t\t\tif ( backend.get( texture ).externalTexture !== undefined || this.textures.get( texture ).isDefaultTexture ) {
\t\t\t\t\t\tcacheBindings = false;
\t\t\t\t\t} else {
\t\t\t\t\t\tcacheKey += texture.id + ',';
\t\t\t\t\t\tversion += texture.version;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t\tthis.backend.updateBindings( bindGroup, bindings, cacheBindings ? cacheKey : '', version );`
      );
      if (trial === 'lazy-resources')
        s = replace(
          s,
          '\t\t\t\tconst texturesTextureData = this.textures.get( texture );\n\n\t\t\t\tif ( updated ) {',
          '\t\t\t\tif ( updated ) {\n\n\t\t\t\t\tconst texturesTextureData = this.textures.get( texture );'
        );
      sources[bindings] = s;
    } else if (trial === 'group-epoch') {
      let s = replace(
        sources[bindings],
        '\t_update( bindGroup, bindings ) {\n',
        `\t_update( bindGroup, bindings ) {
\t\t// BindGroup's native invariant: all bindings have the same groupNode.
\t\tif ( bindGroup.bindings.length === 0 ) return;
\t\tconst groupNode = bindGroup.bindings[ 0 ].groupNode;
\t\tlet epochData;
\t\tlet epochVersion;
\t\tif ( groupNode.updateType !== 'object' ) {
\t\t\tepochData = this.get( bindGroup );
\t\t\tepochVersion = groupNode.version;
\t\t\tif ( epochData.updateGroupNode === groupNode && epochData.updateGroupVersion === epochVersion ) return;
\t\t}
`
      );
      s = replace(
        s,
        '\n\t\t}\n\n\t}\n\n}\n\nexport default Bindings;',
        '\n\t\t}\n\n\t\tif ( epochData !== undefined ) {\n\t\t\tepochData.updateGroupNode = groupNode;\n\t\t\tepochData.updateGroupVersion = epochVersion;\n\t\t}\n\n\t}\n\n}\n\nexport default Bindings;'
      );
      sources[bindings] = s;
    } else if (trial === 'hoist-scope') {
      const s = sources[bindings];
      const start = s.indexOf('\n\t_update( bindGroup, bindings )');
      let update = s.slice(start);
      update = replace(
        update,
        '\t_update( bindGroup, bindings ) {',
        "\t_update( bindGroup, bindings ) {\n\n\t\t// Native BindGroup invariant: every binding has the same groupNode.\n\t\tconst perObject = bindGroup.bindings.length > 0 && bindGroup.bindings[ 0 ].groupNode.updateType === 'object';"
      );
      update = replace(
        update,
        'const updatedGroup = this.nodes.updateGroup( binding );',
        'const updatedGroup = perObject || this.nodes.updateGroup( binding );'
      );
      sources[bindings] = s.slice(0, start) + update;
    } else if (trial === 'fused-bindings') {
      // Inline the existing private method at its only native call site. Keep
      // traversal order, per-binding checks and buffer ownership unchanged.
      const s = sources[bindings];
      const marker = '\t_update( bindGroup, bindings ) {';
      const start = s.indexOf(marker) + marker.length;
      const end = s.lastIndexOf('\n\t}\n\n}\n\nexport default Bindings;');
      assert(start > marker.length && end > start);
      const body = s.slice(start, end);
      assert(!body.includes('return;'), 'fuse only the original no-return body');
      sources[bindings] = replace(
        s,
        '\t\t\tthis._update( bindGroup, bindings );',
        body
          .split('\n')
          .map((line) => '\t' + line)
          .join('\n')
      );
    } else if (trial === 'init-field') {
      sources[renderObject] = replace(
        sources[renderObject],
        'this._bindings = null;',
        'this._bindings = null;\n\t\tthis._bindingsInitialized = false;'
      );
      let s = sources[bindings];
      s = replace(
        s,
        '\t\tconst renderObjectData = this.get( renderObject );\n\n\t\tif ( renderObjectData.initialized !== true ) {',
        '\t\tif ( renderObject._bindingsInitialized !== true ) {'
      );
      s = replace(
        s,
        'renderObjectData.initialized = true;',
        'renderObject._bindingsInitialized = true;'
      );
      s = replace(
        s,
        '\t\tthis.delete( renderObject );',
        '\t\trenderObject._bindingsInitialized = false;\n\t\tthis.delete( renderObject );'
      );
      sources[bindings] = s;
    } else if (trial === 'uniform-kind') {
      let s = replace(
        sources[uniforms],
        'this.index = - 1;',
        'this.index = - 1;\n\t\tthis._uniformKind = 0;'
      );
      let g = sources[group];
      const types = ['Number', 'Vector2', 'Vector3', 'Vector4', 'Color', 'Matrix3', 'Matrix4'];
      for (let i = 0; i < types.length; i++) {
        const type = types[i];
        s = replace(
          s,
          `this.is${type}Uniform = true;`,
          `this.is${type}Uniform = true;\n\t\tthis._uniformKind = ${i + 1};`
        );
        g = replace(
          g,
          `if ( uniform.is${type}Uniform ) return this.update${type}( uniform );`,
          `if ( uniform._uniformKind === ${i + 1} ) return this.update${type}( uniform );`
        );
      }
      sources[uniforms] = s;
      sources[group] = g;
    } else if (trial === 'binding-kind') {
      let s = sources[bindings];
      s = replace(
        s,
        '\t\t\t\t// initialize\n',
        `\t\t\t\t// Cache readonly binding classifications in a compact, manager-local array.
\t\t\t\tgroupData.bindingTypes = Uint8Array.from( bindGroup.bindings, binding =>
\t\t\t\t\t( binding.isStorageBuffer ? 1 : 0 ) | ( binding.isUniformBuffer ? 2 : 0 ) |
\t\t\t\t\t( binding.isSampledTexture ? 4 : 0 ) | ( binding.isSampler ? 8 : 0 ) |
\t\t\t\t\t( binding.isBuffer ? 16 : 0 ) );
\t\t\t\t// initialize
`
      );
      const start = s.indexOf('\n\t_update( bindGroup, bindings )');
      let update = s.slice(start);
      update = replace(
        update,
        '\t\tfor ( const binding of bindGroup.bindings ) {',
        `\t\tconst bindingTypes = this.get( bindGroup ).bindingTypes;
\t\tfor ( let i = 0; i < bindGroup.bindings.length; i ++ ) {
\t\t\tconst binding = bindGroup.bindings[ i ];
\t\t\tconst kind = bindingTypes[ i ];`
      );
      for (const [flag, bit] of [
        ['StorageBuffer', 1],
        ['UniformBuffer', 2],
        ['SampledTexture', 4],
        ['Sampler', 8],
      ])
        update = replace(update, `if ( binding.is${flag} )`, `if ( ( kind & ${bit} ) !== 0 )`);
      update = replace(
        update,
        'if ( binding.isBuffer && binding.updateRanges.length > 0 )',
        'if ( ( kind & 16 ) !== 0 && binding.updateRanges.length > 0 )'
      );
      sources[bindings] = s.slice(0, start) + update;
    } else if (trial.endsWith('-loops') || trial.startsWith('loop-')) {
      const all = trial === 'index-loops' || trial === 'local-loops';
      const local = trial === 'local-loops';
      let s = sources[bindings];
      const start = s.indexOf('\n\t_updateBindings( bindings )');
      let update = s.slice(start);
      if (all || trial === 'loop-groups')
        update = replace(
          update,
          '\t\tfor ( const bindGroup of bindings ) {',
          '\t\tfor ( let i = 0; i < bindings.length; i ++ ) {\n\t\t\tconst bindGroup = bindings[ i ];'
        );
      if (all || trial === 'loop-bindings')
        update = replace(
          update,
          '\t\tfor ( const binding of bindGroup.bindings ) {',
          local
            ? '\t\tconst groupBindings = bindGroup.bindings;\n\t\tfor ( let i = 0; i < groupBindings.length; i ++ ) {\n\t\t\tconst binding = groupBindings[ i ];'
            : '\t\tfor ( let i = 0; i < bindGroup.bindings.length; i ++ ) {\n\t\t\tconst binding = bindGroup.bindings[ i ];'
        );
      sources[bindings] = s.slice(0, start) + update;
      if (all || trial === 'loop-uniforms')
        sources[group] = replace(
          sources[group],
          '\t\tfor ( const uniform of this.uniforms ) {',
          local
            ? '\t\tconst uniforms = this.uniforms;\n\t\tfor ( let i = 0; i < uniforms.length; i ++ ) {\n\t\t\tconst uniform = uniforms[ i ];'
            : '\t\tfor ( let i = 0; i < this.uniforms.length; i ++ ) {\n\t\t\tconst uniform = this.uniforms[ i ];'
        );
    } else if (trial === 'material-scope') {
      let s = replace(
        sources[materials],
        '{ float, uniform, uv, vec3, vec4 }',
        '{ float, uniform, renderGroup, uv, vec3, vec4 }'
      );
      s = replace(
        s,
        '\n    p.tileNode = controls.tile;',
        '\n    // Controls are stable across objects within a native render call.\n    for (const node of Object.values(controls)) node.setGroup(renderGroup);\n    p.tileNode = controls.tile;'
      );
      sources[materials] = s;
    }
  }
  return sources;
}
