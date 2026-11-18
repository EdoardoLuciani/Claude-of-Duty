"""Check the editable case, hinge motion and the adjacent native or cooked export."""
import argparse
import json
from math import radians
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Euler
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import HINGE, SPARK

# Gameplay opens through this angle; sample the actual saved assembly every degree.
OPEN_RADIANS = 1.65


def triangles(obj):
    obj.data.calc_loop_triangles()
    return BVHTree.FromPolygons([obj.matrix_world @ v.co for v in obj.data.vertices],
                               [tri.vertices[:] for tri in obj.data.loop_triangles],
                               all_triangles=True)


def check_scene():
    root, hinge, spark = (bpy.data.objects[name] for name in ('INTEL_CASE', 'INTEL_HINGE', 'INTEL_SPARK'))
    assert hinge.parent == root and spark.parent == root
    assert all(abs(a-b) < 1e-6 for a,b in zip(hinge.location, HINGE))
    assert all(abs(a-b) < 1e-6 for a,b in zip(spark.location, SPARK))
    assert hinge.rotation_euler[:] == (0,0,0)
    moving = [obj for obj in hinge.children if obj.type == 'MESH']
    fixed = [obj for obj in root.children if obj.type == 'MESH']
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ v.co for obj in fixed + moving for v in obj.data.vertices]
    bounds = [(min(p[i] for p in points), max(p[i] for p in points)) for i in range(3)]
    for actual, limit in zip(bounds, [(-.375,.375),(-.293,.245),(0,.488)]):
        assert limit[0] <= actual[0] < actual[1] <= limit[1], (actual,limit)
    stationary = [(obj, triangles(obj)) for obj in fixed]
    angles = [radians(i) for i in range(95)] + [OPEN_RADIANS]
    try:
        for angle in angles:
            hinge.rotation_euler = Euler((-angle,0,0))
            bpy.context.view_layer.update()
            for part in moving:
                sweep = triangles(part)
                for other, bed in stationary:
                    assert not sweep.overlap(bed), (angle, part.name, other.name)
    finally:
        hinge.rotation_euler.x = 0
        bpy.context.view_layer.update()
    print(f'Case envelope (Blender metres): {bounds}; {len(angles)} hinge samples clear')


def check_glb(path):
    data = path.read_bytes()
    magic, version, size, length = struct.unpack_from('<4sIII', data)
    assert (magic, version, size) == (b'glTF',2,len(data))
    doc = json.loads(data[20:20+length])
    nodes = {node['name']: node for node in doc['nodes']}

    def names(name):
        return {doc['nodes'][i]['name'] for i in nodes[name]['children']}

    assert names('INTEL_CASE') == {'INTEL_BODY','INTEL_LEDS','INTEL_HINGE','INTEL_SPARK'}
    assert names('INTEL_HINGE') == {'INTEL_LID','INTEL_BEACON'}
    for name, (x,y,z) in [('INTEL_HINGE',HINGE),('INTEL_SPARK',SPARK)]:
        node = nodes[name]
        assert all(abs(a-b) < 1e-6 for a,b in zip(node['translation'],(x,z,-y)))
        assert tuple(node.get('rotation', (0,0,0,1))) == (0,0,0,1)
        assert 'scale' not in node
    parts = {name: doc['meshes'][nodes[name]['mesh']]['primitives']
             for name in ('INTEL_BODY','INTEL_LID','INTEL_BEACON','INTEL_LEDS')}
    assert all(len(prims) == 1 for prims in parts.values()), 'one draw per rigid or emissive batch'
    body, lid, lens, leds = (prims[0] for prims in parts.values())
    assert body['material'] == lid['material'] and len({body['material'],lens['material'],leds['material']}) == 3
    assert len(doc['materials']) == 3 and len(doc['images']) == 2 and not doc.get('animations')
    assert all('uri' not in image for image in doc['images']), 'self-contained textures'
    assert 'KHR_lights_punctual' not in doc.get('extensionsUsed',[])
    total = sum(doc['accessors'][prim['indices']]['count']//3 for prim in (body,lid,lens,leds))
    assert total <= 5900, 'do not regress the previous triangle budget'
    print(f'{path.name}: {total} triangles, 4 draws, 3 materials, 2 embedded maps, {len(data)} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('glbs', nargs='*', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    check_scene()
    for path in args.glbs or [Path(bpy.data.filepath).with_suffix('.glb')]:
        check_glb(path)
