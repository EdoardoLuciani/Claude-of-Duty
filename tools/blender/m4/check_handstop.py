"""Check the fitted M4A1 hand stop against its real rail, hands and native clips."""
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import attachment_source as source

scene = bpy.context.scene
mount = bpy.data.objects['MOUNT_support']
rig = bpy.data.objects['M4_RIG']
wrist = bpy.data.objects['hand_L']
meshes = [o for o in bpy.data.collections['M4A1 | authored components'].objects if o.type == 'MESH']
hands = [o for o in scene.objects if o.type == 'MESH' and
         any('authored hands' in c.name for c in o.users_collection)]
assert mount.parent.name == 'handguard' and hands


def pose(name, frame):
    for obj in scene.objects:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name
    scene.frame_set(math.floor(frame), subframe=frame % 1)
    bpy.context.view_layer.update()


pose('Idle', 0)
objects = source.seat('handstop', mount)
body = source.named(objects, 'Handstop_body')
contact = source.named(objects, 'SOCKET_support_contact')
seat_inverse = mount.matrix_world.inverted()


def bounds(objects, frame, extra=()):
    points = [frame @ obj.matrix_world @ Vector(p) for obj in objects for p in obj.bound_box]
    points.extend(extra)
    return [(min(p[i] for p in points)-1e-5, max(p[i] for p in points)+1e-5) for i in range(3)]


stop = source.surface([body], seat_inverse)
stop_bounds = bounds([body], seat_inverse)
pad = seat_inverse @ contact.matrix_world.translation
assert stop.find_nearest(pad)[3] < .001, 'support contact datum is off the stop surface'
rest = wrist.location.copy()
indexed = rig.matrix_world.inverted() @ source.named(objects, 'SOCKET_support_wrist').matrix_world.translation
laser = source.seat('laser', bpy.data.objects['MOUNT_rail'])
laser_meshes = [o for o in laser if o.type == 'MESH']
laser_body = source.surface(laser_meshes, seat_inverse)
assert not stop.overlap(laser_body), 'hand stop obstructs TOR Mini'
emitter = source.named(laser, 'SOCKET_laser')
beam = seat_inverse @ emitter.matrix_world
forward = (beam.to_3x3() @ Vector((0, 1, 0))).normalized()
laser_bounds = bounds(laser_meshes, seat_inverse, (beam.translation, beam.translation + forward))
assert stop.ray_cast(beam.translation, forward, 1)[0] is None
accessories = [('laser', laser_body, laser_bounds)]
for id in (*source.OPTICS, 'srd762ti'):
    slot = 'optic' if id in source.OPTICS else 'muzzle'
    fitted = source.seat(id, bpy.data.objects['MOUNT_'+slot], weapon='m4')
    fitted_meshes = [o for o in fitted if o.type == 'MESH']
    fitted_body = source.surface(fitted_meshes, seat_inverse)
    assert not stop.overlap(fitted_body), (id, 'attachment clips stop')
    accessories.append((id, fitted_body, bounds(fitted_meshes, seat_inverse)))

# Stop body is rigid under the handguard. Only bottom rail teeth may mate with it.
fixed = [o for o in meshes if o.parent.name in (
    'receiver', 'handguard', 'IRON_sights', 'IRON_sights_removed', 'MUZZLE_device', 'MUZZLE_device_removed'
)]
teeth = [o for o in fixed if o.name.startswith('RIS II bottom tooth')]
assert stop.overlap(source.surface(teeth, seat_inverse)), 'no saddle contact on physical teeth'
assert not stop.overlap(source.surface([o for o in fixed if o not in teeth], seat_inverse)), 'stop cuts fixed hardware'

# Mirror the M4 adapter's smooth wrist offset. Finger rotations stay authored;
# translate the evaluated support skin to check the unchanged wrap and transfer path.
clips = json.loads(scene['clips'])
moving = [o for o in meshes if o not in fixed]
count = 0
contacts = []
violations = []

def near(obj, transform, box):
    bounds = [transform @ obj.matrix_world @ Vector(p) for p in obj.bound_box]
    return all(max(p[i] for p in bounds) >= lo and min(p[i] for p in bounds) <= hi
               for i, (lo, hi) in enumerate(box))


for name, info in clips.items():
    pose(name, 0)
    end = info['duration'] * 120
    for frame in range(math.ceil(end) + 1):
        sample = min(frame, end)
        scene.frame_set(math.floor(sample), subframe=sample % 1)
        inverse = mount.matrix_world.inverted()
        distance = (wrist.location-rest).length
        t = min(1, distance / .055)
        transfer = min(1, distance / .050)
        local_delta = (indexed-rest) * (1 - t*t*(3 - 2*t))
        local_delta += Vector((0, -.023, -.008)) * (4 * transfer * (1 - transfer))
        delta = rig.matrix_world.to_3x3() @ local_delta
        grip_gap = math.inf
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for hand in hands:
            left = hand.name.startswith('M4_left_')
            transform = inverse @ Matrix.Translation(delta) if left else inverse
            evaluated = hand.evaluated_get(depsgraph)
            at_stop = near(evaluated, transform, stop_bounds)
            nearby = [(id, target) for id, target, envelope in accessories
                      if left and near(evaluated, transform, envelope)]
            if not at_stop and not nearby:
                continue
            skin = source.surface([hand], transform)
            for id, target in nearby:
                assert not target.overlap(skin), (name, frame, id, 'attachment clips fitted hand')
                if id == 'laser':
                    assert skin.ray_cast(beam.translation, forward, 1)[0] is None, (
                        name, frame, 'fitted hand blocks TOR Mini beam'
                    )
            if at_stop and left and t < 1e-5:
                grip_gap = min(grip_gap, skin.find_nearest(pad)[3])
            overlaps = stop.overlap(skin) if at_stop else []
            if overlaps:
                violations.append((name, frame, hand.name, len(overlaps), t))
        if t < 1e-5:
            contacts.append((name, frame, grip_gap))
        near_mechanisms = [o for o in moving if min(o.scale) > .5 and near(o, inverse, stop_bounds)]
        if near_mechanisms:
            assert not stop.overlap(source.surface(near_mechanisms, inverse)), (
                name, frame, 'stop intersects moving mechanism'
            )
        count += 1
assert not violations, ('stop intersects review glove', violations[:12])
assert contacts and max(d for _, _, d in contacts) <= .0015, ('glove misses the indexing pad', contacts)
print('M4_HANDSTOP_OK:', count, 'poses,', len(contacts), 'indexed; clear of attachments, laser beam and moving hardware;',
      'pad gap range (mm)', [round(1000*f(d for _, _, d in contacts), 3) for f in (min, max)])
