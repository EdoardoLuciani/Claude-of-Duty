"""AX338-owned .338 muzzle fit; run on the saved editable weapon scene.

Strict surface checks sample all nine clips at 120 Hz including endpoints.
No bipod exists in this source: this does not certify a future bipod fit.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

# Also runnable standalone on the saved AX338 scene.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import attachment_source
from attachment_source import surface


def check_muzzle():
    scene = bpy.context.scene
    rig = bpy.data.objects['AX338_RIG']
    mount = bpy.data.objects['MOUNT_muzzle']
    brake = bpy.data.objects['MUZZLE_device']
    adapter = bpy.data.objects['MUZZLE_device_removed']
    assert brake.parent == adapter.parent == mount.parent == rig
    assert brake.children and adapter.children
    assert (mount.location-Vector((0, .7958, .075))).length < 1e-6
    assert mount.rotation_euler.to_quaternion().angle < 1e-7
    assert (mount.scale-Vector((1, 1, 1))).length < 1e-7

    def select(clip, time):
        for obj in bpy.data.objects:
            if obj.animation_data:
                obj.animation_data.action = None
                for track in obj.animation_data.nla_tracks:
                    track.mute = track.name != clip
        frame = time*120
        scene.frame_set(int(frame), subframe=frame-int(frame))
        bpy.context.view_layer.update()

    def attachment(id, weapon_mount):
        objects, base = attachment_source.load(id)
        transform = rig.matrix_world.inverted() @ weapon_mount.matrix_world @ base.matrix_world.inverted()
        return surface([obj for obj in objects if obj.type == 'MESH'], transform)

    select('Idle', 0)
    can = attachment('suppressor338', mount)
    fixed_targets = []
    for optic in attachment_source.OPTICS:
        target = attachment(optic, bpy.data.objects['MOUNT_optic'])
        assert not can.overlap(target), (optic, 'can intersects optic')
        fixed_targets.append(target)
    laser = attachment('laser', bpy.data.objects['MOUNT_rail'])
    assert not can.overlap(laser), 'can intersects TOR Mini'
    adapter_meshes = [obj for obj in adapter.children_recursive if obj.type == 'MESH']
    inverse = rig.matrix_world.inverted()
    adapter_tree = surface(adapter_meshes, inverse)
    assert not can.overlap(adapter_tree), 'can intersects adapter sleeve'
    for target in fixed_targets+[laser]:
        assert not adapter_tree.overlap(target), 'adapter intersects optic/laser'
    adapter_points = [inverse @ obj.matrix_world @ v.co for obj in adapter_meshes for v in obj.data.vertices]
    barrel = bpy.data.objects['27 inch barrel']
    barrel_points = [inverse @ barrel.matrix_world @ v.co for v in barrel.data.vertices]
    assert min(v.y for v in adapter_points) >= .7958-1e-6
    assert max(v.y for v in barrel_points) <= .7958+1e-6
    assert abs(min(v.y for v in adapter_points)-max(v.y for v in barrel_points)) < 1e-6, 'adapter not seated on crown'
    # Actual adapter bore must pass the same 10.6 mm gauge as the new can.
    for i in range(48):
        angle = i*math.tau/48
        origin = Vector((.0053*math.cos(angle), .7948, .075+.0053*math.sin(angle)))
        assert adapter_tree.ray_cast(origin, Vector((0, 1, 0)), .022)[0] is None, 'adapter bore blocked'
    body = [obj for obj in bpy.data.collections['AX338 | authored components'].objects
            if obj.type == 'MESH' and obj not in brake.children_recursive and obj not in adapter_meshes]
    hands = [obj for obj in scene.objects if obj.type == 'MESH' and obj.name.startswith(('AX338_left_', 'AX338_right_'))]
    assert hands
    poses = 0
    for clip, info in json.loads(scene['clips']).items():
        for frame in range(math.ceil(info['duration']*120)+1):
            select(clip, min(frame/120, info['duration']))
            inverse = rig.matrix_world.inverted()
            for obj in body+hands:
                target = surface([obj], inverse)
                assert not can.overlap(target), (clip, frame, obj.name, 'can crosses actual surface')
                # The adapter meets only the barrel's crown plane; it is not
                # permitted to intersect any other existing weapon/hand surface.
                if obj.name != '27 inch barrel':
                    assert not adapter_tree.overlap(target), (clip, frame, obj.name, 'adapter crosses actual surface')
            poses += 1
    select('Idle', 0)
    print('AX338_MUZZLE_CLEARANCE_OK:', poses, '120 Hz poses; all existing surfaces and evaluated hands; T-2/ACOG/PM II/TOR Mini; 10.6 mm adapter gauge; no bipod present')


if __name__ == '__main__':
    check_muzzle()
