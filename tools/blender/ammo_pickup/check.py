"""Validate the saved editing scene and its adjacent native/cooked GLBs."""
import json
from pathlib import Path
import struct

import bpy
from mathutils import Matrix


def glb_json(path):
    with path.open('rb') as src:
        assert src.read(8) == b'glTF\x02\0\0\0', path
        _, json_bytes, kind = struct.unpack('<II4s', src.read(12))
        assert kind == b'JSON', path
        return json.loads(src.read(json_bytes))


def check_export(path, cooked):
    data = glb_json(path)
    assert len(data['scenes']) == len(data['nodes']) == len(data['meshes']) == len(data['materials']) == 1
    node, = data['nodes']
    assert node['name'] == 'Ammo_Case' and node['mesh'] == 0
    assert not node.keys() & {'translation', 'rotation', 'scale', 'matrix', 'children', 'skin'}
    assert not data.keys() & {'animations', 'skins', 'cameras'}
    primitive, = data['meshes'][0]['primitives']
    assert primitive['material'] == 0 and primitive.get('mode', 4) == 4
    assert set(primitive['attributes']) == {'POSITION', 'NORMAL', 'TEXCOORD_0'}
    pos = data['accessors'][primitive['attributes']['POSITION']]
    triangles = data['accessors'][primitive['indices']]['count'] // 3
    assert pos['count'] <= 900 and triangles <= 450, (pos['count'], triangles)
    for actual, expected in zip(pos['min'] + pos['max'], [-.201, .025, -.144, .201, .260, .151], strict=True):
        assert abs(actual - expected) < .0001, (actual, expected)
    material, = data['materials']
    assert material.get('alphaMode', 'OPAQUE') == 'OPAQUE' and not material.get('doubleSided')
    pbr = material['pbrMetallicRoughness']
    assert pbr['baseColorTexture']['index'] != pbr['metallicRoughnessTexture']['index']
    assert len(data['images']) == len(data['textures']) == 2
    for image in data['images']:
        assert 'bufferView' in image and image['mimeType'] == ('image/ktx2' if cooked else 'image/png')
    if cooked:
        assert {'KHR_texture_basisu', 'EXT_meshopt_compression'} <= set(data['extensionsUsed'])
    print(f'{path.name}: {triangles} triangles, {pos["count"]} vertices, {path.stat().st_size} bytes')


scene = bpy.context.scene
assert all(obj.type == 'MESH' and obj.matrix_world == Matrix.Identity(4) for obj in scene.objects)
materials = set()
for obj in scene.objects:
    assert len(obj.data.materials) == len(obj.data.uv_layers) == 1
    assert all(face.area > 1e-8 for face in obj.data.polygons), obj.name
    assert all(0 < coord < 1 for loop in obj.data.uv_layers.active.uv for coord in loop.vector), obj.name
    materials.update(obj.data.materials)
assert len(materials) == 1
for name, size in [('Ammo_Case_BaseColor', 256), ('Ammo_Case_MetalRough', 128)]:
    image = bpy.data.images[name]
    assert image.packed_file and tuple(image.size) == (size, size), name
blend = Path(bpy.data.filepath)
check_export(blend.with_suffix('.glb'), cooked=False)
check_export(blend.with_suffix('.runtime.glb'), cooked=True)
print('Ammo Case: editable components, packed atlases, identity origin and one opaque runtime primitive verified')
