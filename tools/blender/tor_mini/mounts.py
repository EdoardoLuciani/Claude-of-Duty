"""Sample actual mounted TOR Mini surfaces in an existing editable weapon scene.

Called by weapon checks; may also run independently to distinguish laser fit
from pre-existing weapon/hand certificates. Sampling is not continuous clearance
or browser/runtime-hand acceptance. No proxy attachment boxes or GLB rewriting.
"""
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import attachment_source
from attachment_source import bounds, geometry, surface, tree

# Only mating rail surfaces may contact the clamp, inside the local seat patch.
PROFILES = {
    'm4': ('M4_RIG', 'M4A1 | authored components', 'handguard', ('RIS II 1 tooth',)),
    'p320': ('P320_RIG', 'P320 | high bake source (not exported)', 'frame', ('Frame |',)),
    'evolys': ('EVOLYS_RIG', 'EVOLYS | authored components', 'handguard', ('handguard_mesh',)),
    'm590': ('M590_RIG', 'M590 | authored components', 'receiver', ('Laser rail adapter tooth',)),
    'ax338': ('AX338_RIG', 'AX338 | authored components', 'AX338_RIG', ('Laser rail adapter tooth',)),
    'mcx': ('MCX_RIG', 'MCX VIRTUS | authored components', 'receiver', ('Laser rail adapter tooth',)),
    'mpx': ('MPX_RIG', 'MPX | editable exterior components', 'receiver', ('Laser rail adapter tooth',)),
}
FOREGRIP_GUARDS = {
    'mcx': 'Hollow octagonal VIRTUS handguard',
    'mpx': 'Hollow five-slot M-LOK handguard',
    'ax338': 'Octagonal slotted forend',
}


def underside_rail(weapon, guard, weapon_meshes, inverse):
    """Check fixed seating, then return the targets for the shared clip sweep."""
    parent = bpy.data.objects['MOUNT_foregrip'].parent
    backing = bpy.data.objects['Foregrip rail adapter backing']
    rails = [o for o in weapon_meshes if o.name.startswith(attachment_source.FOREGRIP_ADAPTER_SURFACES)]
    assert rails and all(o.parent == parent == guard.parent for o in [*rails, backing]), (weapon, 'underside rail must travel with the guard')
    backing_tree, rails_tree = surface([backing], inverse), surface(rails, inverse)
    assert backing_tree.overlap(surface([guard], inverse)), (weapon, 'floating underside backing')
    assert backing_tree.overlap(rails_tree), (weapon, 'rail detached from backing')
    corners = bounds([backing, *rails], inverse)
    low, high = ([reduce(p[i] for p in corners) for i in range(3)] for reduce in (min, max))
    return (backing_tree, rails_tree), low, high


def overlaps_bounds(points, low, high):
    return all(max(p[i] for p in points) >= low[i] and min(p[i] for p in points) <= high[i] for i in range(3))


def check_laser_mount(weapon):
    rig_name, collection, parent, seats = PROFILES[weapon]
    scene = bpy.context.scene
    rig = bpy.data.objects[rig_name]
    mount = bpy.data.objects['MOUNT_rail']
    if weapon == 'p320':
        assert mount.parent_type == 'BONE' and mount.parent_bone == parent
    else:
        assert mount.parent.name == parent, (weapon, 'wrong animated rail parent')
    inverse = mount.matrix_world.inverted()
    weapon_meshes = [o for o in bpy.data.collections[collection].objects if o.type == 'MESH']
    hands = [o for o in scene.objects if o.type == 'MESH' and any(
        'authored hands' in c.name or 'review hands' in c.name for c in o.users_collection)]
    assert hands, (weapon, 'missing deformed review hands')
    # EVOLYS joins the actual support parts into its handguard; the authored
    # vertex group preserves their identity without treating the whole guard as new.
    hardware_sources = []
    if weapon == 'evolys':
        hardware_sources = [(bpy.data.objects['handguard_mesh'], 'LASER_mount_hardware')]
    elif weapon in ('mpx','mcx','m590'):
        hardware_sources = [(o, None) for o in weapon_meshes if o.name.startswith('Laser rail ')]
        assert hardware_sources, (weapon, 'missing laser support hardware')
    hardware_vertices, hardware_faces = [], []
    for obj, group in hardware_sources:
        points, triangles = geometry(obj, inverse, group)
        offset = len(hardware_vertices)
        hardware_vertices.extend(points)
        hardware_faces.extend(tuple(offset + i for i in triangle) for triangle in triangles)
    hardware = tree(hardware_vertices, hardware_faces) if hardware_faces else None
    loaded, base = attachment_source.load('laser', ('ATTACHMENT_tor_mini', 'TOR_MINI_body', 'SOCKET_mount', 'SOCKET_laser'))
    body = attachment_source.named(loaded, 'TOR_MINI_body')
    emitter = attachment_source.named(loaded, 'SOCKET_laser')
    vertices, faces = geometry(body, base.matrix_world.inverted())
    laser = tree(vertices, faces)
    emission = base.matrix_world.inverted() @ emitter.matrix_world.translation
    forward = Vector((0, 1, 0))
    # Reuse the laser's evaluated hand/mechanism sweep for the fixed underside rail.
    foregrip = ()
    if weapon in FOREGRIP_GUARDS:
        guard = bpy.data.objects[FOREGRIP_GUARDS[weapon]]
        foregrip, grip_low, grip_high = underside_rail(weapon, guard, weapon_meshes, inverse)
        moving = set(hands) | {o for o in weapon_meshes if o.parent and o.parent not in (rig, guard.parent) and o.parent.animation_data}
    if weapon == 'mcx':
        sight = inverse @ bpy.data.objects['SOCKET_sight'].matrix_world.translation
        sight_direction = (inverse.to_3x3() @ rig.matrix_world.to_3x3() @ Vector((1,0,0))).normalized()
        assert laser.ray_cast(sight,sight_direction,1)[0] is None, 'MCX laser blocks ACOG sight line'
    # Independent optics share the same authored contact frame. Integrated
    # MCX/MPX optics and suppressors are already part of weapon_meshes.
    optics = []
    optic_objects = []
    if weapon not in ('mcx', 'mpx', 'p320'):
        for optic in attachment_source.OPTICS:
            objects = attachment_source.seat(optic, bpy.data.objects['MOUNT_optic'], weapon=weapon)
            optics.extend(o for o in objects if o.type == 'MESH')
            optic_objects.extend(objects)
    clips = json.loads(scene['clips'])
    count = 0
    contact = False
    try:
        for name, clip in clips.items():
            # All clips, including pump/bolt/slide motion and reload hands,
            # use a 120 Hz sweep plus exact fractional endpoints.
            rate = 120
            duration = clip['duration']
            for o in scene.objects:
                if o.animation_data:
                    o.animation_data.action = None
                    for track in o.animation_data.nla_tracks:
                        track.mute = track.name != name
            for sample in range(math.ceil(duration * rate) + 1):
                frame = min(sample / rate, duration) * scene.render.fps
                scene.frame_set(math.floor(frame), subframe=frame % 1)
                bpy.context.view_layer.update()
                inverse = mount.matrix_world.inverted()
                # Source +Y forward must remain weapon-forward, even during pump/slide travel.
                direction = (rig.matrix_world.inverted().to_3x3() @ mount.matrix_world.to_3x3() @ forward).normalized()
                expected = Vector((1, 0, 0)) if weapon in ('mcx', 'mpx') else Vector((0, 1, 0))
                assert (direction - expected).length < 1e-6, (weapon, name, sample, 'emitter direction')
                for obj in weapon_meshes + hands + optics:
                    if min(obj.scale) < .001:
                        continue  # authored STEP-hidden transfer parts
                    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
                    corners = bounds([evaluated], inverse)
                    # Broad phase covers both the real module and its forward
                    # emission corridor; only overlapping surfaces need a BVH.
                    low, high = (-.018, -.028, -.032), (.018, 1.026, .007)
                    check_hardware = hardware is not None and obj in hands
                    check_laser = check_hardware or overlaps_bounds(corners, low, high)
                    check_foregrip = foregrip and obj in moving and overlaps_bounds(corners, grip_low, grip_high)
                    if not check_laser and not check_foregrip:
                        continue
                    points, triangles = geometry(obj, inverse)
                    target = tree(points, triangles)
                    if check_foregrip:
                        assert not any(rail.overlap(target) for rail in foregrip), (weapon, name, sample, obj.name, 'underside rail intersects stock animation')
                    if not check_laser:
                        continue
                    if check_hardware:
                        assert not hardware.overlap(target), (weapon, name, sample, obj.name, 'laser support hardware intersects hand')
                    assert target.ray_cast(emission, forward, 1.0)[0] is None, (weapon, name, sample, obj.name, 'blocked emitter')
                    overlaps = laser.overlap(target)
                    for laser_face, weapon_face in overlaps:
                        # Rail teeth/clamp mating only: never exempt the hand,
                        # adapter web, whole forend, or an entire frame mesh.
                        patch = [points[i] for i in triangles[weapon_face]]
                        mating = obj.name.startswith(seats) and all(
                            abs(p.x) <= .015 and (-.060 if weapon == 'p320' else -.030) <= p.y <= .035 and -.0006 <= p.z <= .015 for p in patch)
                        assert mating, (weapon, name, sample, obj.name, 'laser intersection', [tuple(p) for p in patch])
                        contact = True
                count += 1
        if weapon == 'ax338':
            # There is no fold clip: mirror the existing separate physical
            # hinge sweep, without inventing an animation or touching hands.
            for o in scene.objects:
                if o.animation_data:
                    for track in o.animation_data.nla_tracks:
                        track.mute = track.name != 'Idle'
            scene.frame_set(0)
            inverse = rig.matrix_world.inverted()
            mounted = tree([inverse @ mount.matrix_world @ p for p in vertices], faces)
            pivot = Vector((-.019, -.1165, .0445))
            for angle in range(181):
                rotation = Matrix.Translation(pivot) @ Matrix.Rotation(-math.radians(angle), 4, 'Z') @ Matrix.Translation(-pivot)
                for obj in bpy.data.objects['stock'].children_recursive:
                    if obj.type == 'MESH':
                        points, triangles = geometry(obj, inverse @ rotation)
                        assert not mounted.overlap(tree(points, triangles)), (weapon, angle, obj.name, 'fold hits laser')
        assert contact, (weapon, 'no actual rail/clamp contact')
    finally:
        for obj in loaded + optic_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for o in scene.objects:
            if o.animation_data:
                for track in o.animation_data.nla_tracks:
                    track.mute = track.name != 'Idle'
        scene.frame_set(0)
    print('TOR_MINI_MOUNT_OK:', weapon, count, 'sampled poses; actual rail contact, emitter ray, weapon/mechanisms and', len(hands), 'review-hand meshes; runtime/visual review separate')
    if foregrip:
        print('UNDERSIDE_RAIL_OK:', weapon, count, 'sampled stock poses')


if __name__ == '__main__':
    check_laser_mount(sys.argv[sys.argv.index('--') + 1])
