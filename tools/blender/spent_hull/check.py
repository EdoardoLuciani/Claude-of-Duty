"""Check the editable hull surface (stock GLB contract is checked by cook.ts)."""

from math import isclose

import bmesh
import bpy
from mathutils.bvhtree import BVHTree


obj, = bpy.context.scene.objects
assert obj.name == 'spent12g' and obj.type == 'MESH'
mesh = bmesh.new()
try:
    mesh.from_mesh(obj.data)
    assert all(edge.is_manifold and edge.is_contiguous for edge in mesh.edges), 'closed, consistently wound wall'
    assert mesh.calc_volume(signed=True) > 0, 'outward-facing surface'
    assert all(face.calc_area() > 0 for face in mesh.faces), 'no degenerate faces'
    bvh = BVHTree.FromBMesh(mesh)
    for x, y in ((0, 0), (.002, 0), (-.002, 0), (0, .002), (0, -.002)):
        at, normal, _, _ = bvh.ray_cast((x, y, .03), (0, 0, -1))
        assert at is not None and at.z < -.01 and normal.z > .9, 'deep open mouth in front of its floor'
    hit, _, _, _ = bvh.ray_cast((0, 0, -.03), (0, 0, 1))
    edge, _, _, _ = bvh.ray_cast((.004, 0, -.03), (0, 0, 1))
    assert hit is not None and edge is not None and not isclose(hit.z, edge.z, abs_tol=1e-4), 'recessed strike'
finally:
    mesh.free()
print('Spent hull: manifold outward-facing wall, open mouth and recessed strike')
