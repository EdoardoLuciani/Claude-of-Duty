// Declaration gaps verified against Three.js r187 (0.187.0).
// Keep these signatures narrow and review them when upgrading Three/@types.
import type { Node, TextureNode } from 'three/webgpu';
import 'three/src/nodes/core/NodeBuilder.js';
import 'three/src/nodes/core/Node.js';
import 'three/examples/jsm/tsl/display/TRAANode.js';

// src/nodes/core/NodeBuilder.js: shaderStage, hasGeometryAttribute.
declare module 'three/src/nodes/core/NodeBuilder.js' {
  export default interface NodeBuilder {
    shaderStage: 'vertex' | 'fragment' | 'compute' | null;
    hasGeometryAttribute(name: string): boolean;
  }
}

// TSLCore registers these conversions on all nodes, including native WGSL calls.
// Matrix column indexing is registered by ArrayElementNode.
declare module 'three/src/nodes/core/Node.js' {
  interface NodeElements {
    toFloat(): Node<'float'>;
    toVec2(): Node<'vec2'>;
    toVec3(): Node<'vec3'>;
    toVec4(): Node<'vec4'>;
  }
  interface Mat4Extensions {
    element(index: Node<'int'> | number): Node<'vec4'>;
  }
}

// examples/jsm/tsl/display/TRAANode.js: published resolve/history methods.
declare module 'three/examples/jsm/tsl/display/TRAANode.js' {
  export default interface TRAANode {
    getTextureNode(): TextureNode;
    setSize(width: number, height: number): void;
    clearViewOffset(): void;
  }
}
