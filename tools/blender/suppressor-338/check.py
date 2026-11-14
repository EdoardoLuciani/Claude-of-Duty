"""Saved .338 exterior bore/dimension/socket checks; no regeneration."""
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def check_suppressor(export=None):
    mount = bpy.data.objects['SOCKET_mount']
    exit = bpy.data.objects['SOCKET_muzzle']
    assert mount.matrix_world.translation.length < 1e-7
    assert (exit.matrix_world.translation-Vector((0, .280, 0))).length < 1e-7
    for obj in (mount, exit):
        assert (obj.matrix_world.to_scale()-Vector((1, 1, 1))).length < 1e-7
        assert obj.matrix_world.to_quaternion().angle < 1e-7
    vertices, faces = [], []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        offset = len(vertices)
        vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        faces.extend(tuple(offset+i for i in p.vertices) for p in obj.data.polygons)
    assert abs(max(p.y for p in vertices)-min(p.y for p in vertices)-.280) < 1e-6
    assert abs(max(p.x for p in vertices)-.025) < .0002
    bore = BVHTree.FromPolygons(vertices, faces)
    # 10.6 mm clear gauge: .338 projectile (8.59 mm) plus >1 mm radial margin.
    # Tests only this exterior/mount/endcap, not internal baffle engineering.
    for radius in (0, .0025, .0045, .0053):
        for i in range(48):
            origin = Vector((radius*math.cos(i*math.tau/48), -.001, radius*math.sin(i*math.tau/48)))
            assert bore.ray_cast(origin, Vector((0, 1, 0)), .282)[0] is None, '338 bore obstructed'
    if export:
        raw = Path(export).read_bytes()
        length = struct.unpack_from('<I', raw, 12)[0]
        doc = json.loads(raw[20:20+length])
        node = next(n for n in doc['nodes'] if n.get('name') == 'SOCKET_muzzle')
        assert (Vector(node['translation'])-Vector((0, 0, -.280))).length < 1e-6
        assert not doc.get('animations')
    print('SUPPRESSOR338_OK: 280 x 50 mm; unit sockets; 10.6 mm bore gauge; glTF -Z exit' if export
          else 'SUPPRESSOR338_OK: saved geometry/socket/bore checks')


if __name__ == '__main__':
    check_suppressor()
