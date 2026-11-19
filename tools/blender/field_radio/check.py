"""Check the editable scene and native/cooked field-radio export contract."""
import json
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Matrix


def check_scene():
    grip = bpy.data.objects['GRIP_radio']
    screen = bpy.data.objects['SCREEN_radio']
    assert grip.type == 'EMPTY' and grip.matrix_world == Matrix.Identity(4)
    assert screen.parent == grip and screen.matrix_local == Matrix.Identity(4)
    assert all(o.parent == grip and o.type == 'MESH' for o in grip.children)
    assert len({m for o in grip.children for m in o.data.materials}) == 2
    for o in grip.children:
        assert not o.data.validate() and o.data.uv_layers.active, o.name
    assert all(img.packed_file for img in bpy.data.images if img.name.startswith('radio-'))
    assert len(screen.data.polygons) == 1 and screen.data.polygons[0].normal.y < -.999
    for loop in screen.data.loops:
        x, neg_z, y = screen.data.vertices[loop.vertex_index].co
        u, v = screen.data.uv_layers.active.uv[loop.index].vector
        assert abs(neg_z + .01907) < 1e-6
        assert abs(u - ((x + .0198) / .0396)) < 1e-6
        assert abs(v - ((y - .0675) / .0198)) < 1e-6


def check_glb(path):
    raw = path.read_bytes()
    magic, version, size, json_size, kind = struct.unpack_from('<4sIII4s', raw)
    assert (magic, version, size, kind) == (b'glTF', 2, len(raw), b'JSON')
    g = json.loads(raw[20:20 + json_size])
    nodes = {node['name']: node for node in g['nodes']}
    assert set(nodes) == {'GRIP_radio', 'Radio_housing', 'SCREEN_radio'}
    assert {g['nodes'][i]['name'] for i in nodes['GRIP_radio']['children']} == {'Radio_housing', 'SCREEN_radio'}
    for key in ('matrix', 'translation', 'rotation', 'scale'):
        assert not any(key in node for node in nodes.values()), f'unexpected authored {key}'
    housing, lcd = [g['meshes'][nodes[name]['mesh']]['primitives'] for name in ('Radio_housing', 'SCREEN_radio')]
    assert len(housing) == len(lcd) == 1 and len(g['materials']) == len(g['meshes']) == 2
    assert housing[0]['material'] != lcd[0]['material']
    for primitive in (housing[0], lcd[0]):
        assert set(primitive['attributes']) == {'POSITION', 'NORMAL', 'TEXCOORD_0'}
        material = g['materials'][primitive['material']]
        assert material.get('alphaMode', 'OPAQUE') == 'OPAQUE' and not material.get('extensions')
        assert not material.get('doubleSided')
    glass = g['materials'][lcd[0]['material']]
    assert not any(k.endswith('Texture') for k in glass | glass['pbrMetallicRoughness'])
    assert len(g['images']) == 2 and all('bufferView' in img and 'uri' not in img for img in g['images'])
    assert not g.get('animations') and not g.get('skins')
    tri = sum(g['accessors'][p['indices']]['count'] for p in (housing[0], lcd[0])) // 3
    verts = sum(g['accessors'][p['attributes']['POSITION']]['count'] for p in (housing[0], lcd[0]))
    assert tri <= 1300 and verts <= 1800, f'radio budget: {tri} tris, {verts} verts'
    print(f'{path.name}: 2 opaque draws, {tri} tris, {verts} verts, {len(raw)} B')


check_scene()
for product in sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []:
    check_glb(Path(product))
print('Field radio contract OK')
