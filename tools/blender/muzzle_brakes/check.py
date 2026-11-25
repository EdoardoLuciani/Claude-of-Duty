"""Check the fitted M4-72 game prop on an editable weapon, through its clips."""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import attachment_source

HOSTS = {
    'm4a1-block-ii': 'M4A1',
    'mcx-virtus': 'MCX VIRTUS',
    'fn-evolys-762': 'EVOLYS',
    'ax338': 'AX338',
}
collection = HOSTS[Path(bpy.data.filepath).stem]
scene = bpy.context.scene
mount = bpy.data.objects['MOUNT_muzzle']
hidden_parts = {obj for key in ('MUZZLE_device', 'MUZZLE_device_removed')
                if key in bpy.data.objects for obj in bpy.data.objects[key].children_recursive}
weapon = [o for o in bpy.data.collections[f'{collection} | authored components'].objects
          if o.type == 'MESH' and o not in hidden_parts]
hands = [o for o in scene.objects if o.type == 'MESH' and
         any('authored hands' in c.name for c in o.users_collection)]
assert hidden_parts and hands
forward = Vector((0, 1, 0))


def select_clip(name):
    for obj in scene.objects:
        if obj.animation_data:
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name


select_clip('Idle')
scene.frame_set(0)
objects = attachment_source.seat('m4_72', mount)
brake_exit = attachment_source.named(objects, 'SOCKET_muzzle')
shell, = [o for o in objects if o.type == 'MESH']
inverse = mount.matrix_world.inverted()
transform = inverse @ shell.matrix_world
points = [transform @ v.co for v in shell.data.vertices]
shell.data.calc_loop_triangles()
# The retained barrel tip is concealed inside the solid art. Test the visible
# shell, ignoring only the closed rear face at the shared seating plane.
faces = [tuple(t.vertices) for t in shell.data.loop_triangles
         if any(points[i].y > 1e-6 for i in t.vertices)]
surface = BVHTree.FromPolygons(points, faces, all_triangles=True)
low, high = [tuple(f(p[i] for p in points) for i in range(3)) for f in (min, max)]
exit_position = inverse @ brake_exit.matrix_world.translation
assert (exit_position - Vector((0, high[1], 0))).length < 1e-6
assert (inverse.to_3x3() @ brake_exit.matrix_world.to_3x3() @ forward - forward).length < 1e-6
for name in ('SOCKET_sight', 'SOCKET_front_post'):
    if name in bpy.data.objects:
        sight = inverse @ bpy.data.objects[name].matrix_world.translation
        assert surface.ray_cast(sight, forward, 1)[0] is None, ('blocked sight', name)

count = 0
for name, clip in json.loads(scene['clips']).items():
    select_clip(name)
    duration = clip['duration']
    for sample in range(math.ceil(duration * 120) + 1):
        frame = min(sample / 120, duration) * scene.render.fps
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        inverse = mount.matrix_world.inverted()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for obj in weapon + hands:
            if min(obj.scale) < .001:
                continue  # authored STEP-hidden parts
            ref = obj.evaluated_get(depsgraph)
            transform = inverse @ ref.matrix_world
            bounds = [transform @ Vector(p) for p in ref.bound_box]
            # A barrel ending at the seating plane may touch the rear rim, but not cross it.
            if max(p.y for p in bounds) <= low[1]+1e-6:
                continue
            if any(max(p[i] for p in bounds) < low[i] or min(p[i] for p in bounds) > high[i]
                   for i in range(3)):
                continue
            target = attachment_source.surface([obj], inverse)
            assert not surface.overlap(target), (name, sample, obj.name, 'intersects brake')
        count += 1
print('M4_72_FIT_OK:', collection, count,
      '120 Hz poses, aligned prop exit, clear sightline and no body/hand intersections')
