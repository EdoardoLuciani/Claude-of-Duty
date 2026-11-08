"""Read-only acceptance gates for a freshly saved TOR Mini and its native GLB.

blender -b /tmp/tor-mini-review/tor-mini.blend --python-exit-code 1 \
    --python tools/blender/tor_mini/check.py
These are correctness gates, not a claim of AAA visual or mounted-gameplay acceptance.
"""
import json
import math
from pathlib import Path
import struct

import bpy
from mathutils import Vector


def check():
    root = bpy.data.objects['ATTACHMENT_tor_mini']
    meshes = [obj for obj in root.children_recursive if obj.type == 'MESH']
    assert len(meshes) == 1 and meshes[0].name == 'TOR_MINI_body'
    body = meshes[0]
    assert body.parent == root
    assert not body.modifiers
    assert len(body.data.materials) == 1
    assert len(body.data.uv_layers) == 1
    assert body.data.uv_layers.active.name == 'AtlasUV'
    assert all(len(poly.vertices) == 3 for poly in body.data.polygons)
    assert 0 < len(body.data.polygons) <= 12000
    assert all(math.isfinite(v) for vertex in body.data.vertices for v in vertex.co)
    assert all(edge.vertices[0] != edge.vertices[1] for edge in body.data.edges)
    assert all(poly.area > 1e-14 for poly in body.data.polygons)
    assert all(-1e-6 <= v <= 1.000001 for loop in body.data.uv_layers.active.data for v in loop.uv)
    assert all(poly.material_index == 0 for poly in body.data.polygons)
    bpy.context.view_layer.update()
    points = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
    minimum = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    maximum = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    envelope = (maximum-minimum)*1000
    # Nominal manufacturer envelope; local shape and mounting datum are art-inferred.
    assert 32 < envelope.x < 34 and 52.8 < envelope.y < 53.8 and 30 < envelope.z < 31,envelope
    assert root.location.length == 0 and root.scale[:] == (1,1,1)
    assert bpy.data.objects['SOCKET_mount'].location.length == 0
    emitter = bpy.data.objects['SOCKET_laser']
    assert (emitter.location-Vector((0,.02518,-.0105))).length < 1e-8
    assert emitter.parent == root and emitter.rotation_euler[:] == (0,0,0)
    source = bpy.data.collections['SOURCE_HIGH | editable detailed reference reconstruction']
    assert source.hide_render and source.hide_viewport
    assert any('Pressure pad diamond' in obj.name for obj in source.objects)
    assert all(obj.name.startswith('HIGH_') for obj in source.objects)
    maps = [node.image for node in body.data.materials[0].node_tree.nodes if node.type == 'TEX_IMAGE']
    assert len(maps) == 3 and all(image.size[:] == (2048,2048) for image in maps)
    assert all(image.packed_file for image in maps)
    assert {image.colorspace_settings.name for image in maps} == {'sRGB','Non-Color'}
    output = Path(bpy.data.filepath).parent
    raw = (output/'tor-mini.glb').read_bytes()
    magic,version,length = struct.unpack_from('<III',raw)
    assert magic == 0x46546c67 and version == 2 and length == len(raw)
    size = struct.unpack_from('<I',raw,12)[0]
    doc = json.loads(raw[20:20+size])
    assert len(doc['meshes']) == len(doc['materials']) == 1
    assert len(doc['meshes'][0]['primitives']) == 1
    assert len(doc['images']) == 3
    assert not doc.get('animations') and not doc.get('cameras') and not doc.get('extensions')
    assert all('uri' not in image for image in doc['images'])
    assert not any(node['name'].startswith(('HIGH_','CAM_')) for node in doc['nodes'])
    nodes = {node['name']:node for node in doc['nodes']}
    assert nodes['SOCKET_mount'].get('translation',[0,0,0]) == [0,0,0]
    assert all(abs(a-b)<1e-8 for a,b in zip(nodes['SOCKET_laser']['translation'],[0,-.0105,-.02518]))
    assert doc['materials'][0].get('alphaMode','OPAQUE') == 'OPAQUE'
    assert 'emissiveTexture' not in doc['materials'][0]
    report = {'status':'PASS','triangles':len(body.data.polygons),
        'envelopeMmXYZ':list(envelope),'atlasSize':2048,'primitives':1,
        'note':'Geometry/export correctness only; visual and weapon-fit approval remain separate'}
    print('TOR_MINI_CHECK',json.dumps(report))
    return report


if __name__ == '__main__':
    check()
