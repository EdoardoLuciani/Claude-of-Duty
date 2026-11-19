"""Check the editable visual, including its game-space envelope and UV finish."""

import bmesh
import bpy
import math
from mathutils import Vector

objects = list(bpy.context.scene.objects)
assert [obj.name for obj in objects] == ['MESH_grenade'], 'one rigid exterior mesh'
obj = objects[0]
assert obj.type == 'MESH' and not obj.animation_data
assert obj.matrix_world.is_identity, 'body centre and axes are the instance pivot'
lo = Vector(tuple(min(v[i] for v in obj.bound_box) for i in range(3)))
hi = Vector(tuple(max(v[i] for v in obj.bound_box) for i in range(3)))
assert -.041 < lo.z < -.039 and .100 < hi.z < .104, 'foot and top silhouette'
assert -.056 < lo.x < -.051 and .045 < hi.x < .047, 'lever envelope and body width'
assert -.047 < lo.y < -.045 and .045 < hi.y < .047, 'body sits on the palm centreline'
mesh = obj.data
mesh.calc_loop_triangles()
assert len(mesh.loop_triangles) <= 2200, 'authoring budget before gltfpack'
assert len(mesh.materials) == 1 and mesh.materials[0].use_backface_culling
assert sorted((node.image.name, tuple(node.image.size), bool(node.image.packed_file))
              for node in mesh.materials[0].node_tree.nodes if node.type == 'TEX_IMAGE') == [
    ('M67_Color', (512, 256), True), ('M67_Surface', (512, 256), True),
]
assert all(all(math.isfinite(value) and 0 < value < 1 for value in loop.uv)
           for loop in mesh.uv_layers.active.data), 'finite, padded atlas coordinates'
bm = bmesh.new()
bm.from_mesh(mesh)
assert all(edge.is_manifold and edge.is_contiguous for edge in bm.edges), 'closed oriented islands'
remaining = set(bm.faces)
while remaining:
    work = [remaining.pop()]
    signed_volume = 0.0
    while work:
        face = work.pop()
        corners = [v.co for v in face.verts]
        signed_volume += sum(corners[0].dot(a.cross(b)) for a, b in zip(corners[1:], corners[2:]))
        for edge in face.edges:
            for adjacent in edge.link_faces:
                if adjacent in remaining:
                    remaining.remove(adjacent)
                    work.append(adjacent)
    assert signed_volume > 0, 'outward normals on every exterior island'
bm.free()
print(f'M67 OK: {len(mesh.loop_triangles)} triangles; one material, two packed 512 × 256 maps')
