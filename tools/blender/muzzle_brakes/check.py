"""Check both game-art mounts on the editable M4A1, at rest and through its clips."""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import attachment_source

scene = bpy.context.scene
mount = bpy.data.objects['MOUNT_muzzle']
stock_exit = bpy.data.objects['SOCKET_muzzle']
stock_device = bpy.data.objects['MUZZLE_device']
bare_parts = set(stock_device.children_recursive)
weapon = [o for o in bpy.data.collections['M4A1 | authored components'].objects
          if o.type == 'MESH' and o not in bare_parts]
hands = [o for o in scene.objects if o.type == 'MESH' and
         any('authored hands' in c.name for c in o.users_collection)]
assert bare_parts and hands
forward = Vector((0, 1, 0))

def select_clip(name):
    for obj in scene.objects:
        if obj.animation_data:
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name


for brake in ('crest_brake', 'vector_brake'):
    select_clip('Idle')
    scene.frame_set(0)
    objects = attachment_source.seat(brake, mount)
    brake_exit = attachment_source.named(objects, 'SOCKET_muzzle')
    parts = [o for o in objects if o.type == 'MESH']
    inverse = mount.matrix_world.inverted()
    surface = attachment_source.surface(parts, inverse)
    points = [inverse @ o.matrix_world @ Vector(p) for o in parts for p in o.bound_box]
    low, high = [tuple(f(p[i] for p in points) for i in range(3)) for f in (min, max)]
    # Inspect the actual authored output socket, not the asset name or a proxy box.
    assert (brake_exit.matrix_world.translation - stock_exit.matrix_world.translation).length < 1e-6
    assert (inverse.to_3x3() @ brake_exit.matrix_world.to_3x3() @ forward - forward).length < 1e-6
    for name in ('SOCKET_sight', 'SOCKET_front_post'):
        sight = inverse @ bpy.data.objects[name].matrix_world.translation
        assert surface.ray_cast(sight, forward, 1)[0] is None, (brake, 'blocked iron sight', name)

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
                if any(max(p[i] for p in bounds) < low[i] or min(p[i] for p in bounds) > high[i]
                       for i in range(3)):
                    continue
                target = attachment_source.surface([obj], inverse)
                assert not surface.overlap(target), (brake, name, sample, obj.name, 'intersects brake')
            count += 1
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    print('M4_BRAKE_FIT_OK:', brake, count,
          '120 Hz poses, retained exit, unobstructed iron sight and no body/hand intersections')
