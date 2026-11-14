"""Saved-source bore gauge; sampled exterior game-fit, not baffle engineering."""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def check_source():
    scene = bpy.context.scene
    assert scene.unit_settings.system == 'METRIC' and scene.unit_settings.scale_length == 1
    mount = bpy.data.objects['SOCKET_mount']
    exit = bpy.data.objects['SOCKET_muzzle']
    assert mount.matrix_world.translation.length < 1e-8
    assert (exit.matrix_world.translation-Vector((0, .220, 0))).length < 1e-7
    vertices, faces = [], []
    for obj in scene.objects:
        if obj.type != 'MESH':
            continue
        offset = len(vertices)
        obj.data.calc_loop_triangles()
        vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        faces.extend(tuple(offset+i for i in t.vertices) for t in obj.data.loop_triangles)
    bore = BVHTree.FromPolygons(vertices, faces, all_triangles=True)
    # 18.6 mm shot envelope at the seat, expanding at 7 degrees half-angle.
    # Runtime's worst rest spread is 1.2*1.15*2.2*2 = 6.072 degrees;
    # post-shot spreadMax is 2.1. This deliberately exceeds both, without tuning them.
    count = 0
    for radius in (0, .00465, .0093):
        for i in range(96):
            angle = i*math.tau/96
            start = Vector((radius*math.cos(angle), 0, radius*math.sin(angle)))
            direction = Vector((math.tan(math.radians(7))*math.cos(angle), 1,
                                math.tan(math.radians(7))*math.sin(angle))).normalized()
            assert bore.ray_cast(start, direction, .223)[0] is None, ('shot envelope obstruction', radius, i)
            count += 1
    assert bore.ray_cast(Vector((.039, .23, 0)), Vector((0, -1, 0)), .02)[0] is not None, 'real open annular endcap'
    print('SUPPRESSOR12G_BORE_OK:', count, 'rays; 18.6mm envelope + 7deg half-angle; exit +Y .220m')


if __name__ == '__main__':
    check_source()
