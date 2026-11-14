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
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[3]
# Only mating rail surfaces may contact the clamp, inside the local seat patch.
PROFILES = {
    'p320': ('P320_RIG', 'P320 | high bake source (not exported)', 'frame', ('Frame |',)),
    'evolys': ('EVOLYS_RIG', 'EVOLYS | authored components', 'handguard', ('handguard_mesh',)),
    'm590': ('M590_RIG', 'M590 | authored components', 'receiver', ('Laser rail adapter tooth',)),
    'ax338': ('AX338_RIG', 'AX338 | authored components', 'AX338_RIG', ('Laser rail adapter tooth',)),
    'mcx': ('MCX_RIG', 'MCX VIRTUS | authored components', 'receiver', ('Laser rail adapter tooth',)),
    'mpx': ('MPX_RIG', 'MPX | editable exterior components', 'receiver', ('Laser rail adapter tooth',)),
}


def geometry(obj, transform, group=None):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    matrix = transform @ evaluated.matrix_world
    vertices = [matrix @ v.co for v in mesh.vertices]
    if group is None:
        faces = [tuple(t.vertices) for t in mesh.loop_triangles]
    else:
        index = obj.vertex_groups[group].index
        selected = {v.index for v in mesh.vertices if any(g.group == index and g.weight > .5 for g in v.groups)}
        faces = [tuple(t.vertices) for t in mesh.loop_triangles if all(i in selected for i in t.vertices)]
        assert faces, (obj.name, group, 'missing authored hardware surfaces')
    evaluated.to_mesh_clear()
    return vertices, faces


def tree(vertices, faces):
    return BVHTree.FromPolygons(vertices, faces, all_triangles=True)


def check_laser_mount(weapon):
    rig_name, collection, parent, seats = PROFILES[weapon]
    scene = bpy.context.scene
    rig = bpy.data.objects[rig_name]
    mount = bpy.data.objects['MOUNT_rail']
    if weapon == 'p320':
        assert mount.parent_type == 'BONE' and mount.parent_bone == parent
    else:
        assert mount.parent.name == parent, (weapon, 'wrong animated rail parent')
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
        points, triangles = geometry(obj, mount.matrix_world.inverted(), group)
        offset = len(hardware_vertices)
        hardware_vertices.extend(points)
        hardware_faces.extend(tuple(offset + i for i in triangle) for triangle in triangles)
    hardware = tree(hardware_vertices, hardware_faces) if hardware_faces else None
    path = ROOT / 'assets/attachments/steiner-tor-mini/tor-mini.blend'
    assert path.exists(), f'Build shared TOR Mini first: {path}'
    with bpy.data.libraries.load(str(path), link=False) as (source, loaded):
        loaded.objects = [n for n in source.objects if n in ('ATTACHMENT_tor_mini', 'TOR_MINI_body', 'SOCKET_mount', 'SOCKET_laser')]
    for obj in loaded.objects:
        scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    base = next(o for o in loaded.objects if o.name.startswith('SOCKET_mount'))
    body = next(o for o in loaded.objects if o.name.startswith('TOR_MINI_body'))
    emitter = next(o for o in loaded.objects if o.name.startswith('SOCKET_laser'))
    vertices, faces = geometry(body, base.matrix_world.inverted())
    laser = tree(vertices, faces)
    emission = base.matrix_world.inverted() @ emitter.matrix_world.translation
    forward = Vector((0, 1, 0))
    if weapon == 'mcx':
        inverse = mount.matrix_world.inverted()
        sight = inverse @ bpy.data.objects['SOCKET_sight'].matrix_world.translation
        sight_direction = (inverse.to_3x3() @ rig.matrix_world.to_3x3() @ Vector((1,0,0))).normalized()
        assert laser.ray_cast(sight,sight_direction,1)[0] is None, 'MCX laser blocks ACOG sight line'
    # Independent optics share the same authored contact frame. Integrated
    # MCX/MPX optics and suppressors are already part of weapon_meshes.
    optics = []
    optic_objects = []
    if weapon not in ('mcx', 'mpx'):
        for optic, folder in (('rmr', 'trijicon-rmr'), ('acog', 'trijicon-acog'), ('scope', 'schmidt-bender-pm-ii')):
            if weapon == 'm590' and optic == 'scope':
                continue  # Its compact integrated rail does not support both PM II rings.
            source_path = ROOT / 'assets/attachments' / folder / (optic + '.blend')
            assert source_path.exists(), f'Build shared optic first: {source_path}'
            with bpy.data.libraries.load(str(source_path), link=False) as (source, target):
                target.objects = source.objects
            for obj in target.objects:
                scene.collection.objects.link(obj)
            bpy.context.view_layer.update()
            optic_base = next(o for o in target.objects if o.name.startswith('MOUNT_base'))
            transform = bpy.data.objects['MOUNT_optic'].matrix_world @ optic_base.matrix_world.inverted()
            roots = [o for o in target.objects if o.parent is None]
            for obj in roots:
                matrix = transform @ obj.matrix_world
                obj.parent = bpy.data.objects['MOUNT_optic']
                obj.matrix_world = matrix
            optics.extend(o for o in optic_base.parent.children_recursive if o.type == 'MESH')
            optic_objects.extend(target.objects)
    clips = json.loads(scene['clips'])
    if weapon == 'mcx':
        from mcx.review_hands import review_tracks, select_review_clip
        clips = {track['name']:{'duration':track['times'][-1]} for track in review_tracks()}
    count = 0
    contact = False
    try:
        for name, clip in clips.items():
            # All clips, including pump/bolt/slide motion and reload hands,
            # use a 120 Hz sweep plus exact fractional endpoints.
            rate = 120
            duration = clip['duration']
            if weapon == 'mcx':
                select_review_clip(name)
            else:
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
                    matrix = inverse @ evaluated.matrix_world
                    bounds = [matrix @ Vector(p) for p in evaluated.bound_box]
                    # Broad phase covers both the real module and its forward
                    # emission corridor; only overlapping surfaces need a BVH.
                    low, high = (-.018, -.028, -.032), (.018, 1.026, .007)
                    check_hardware = hardware is not None and obj in hands
                    if not check_hardware and any(max(p[i] for p in bounds) < low[i] or min(p[i] for p in bounds) > high[i] for i in range(3)):
                        continue
                    points, triangles = geometry(obj, inverse)
                    target = tree(points, triangles)
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
        for obj in loaded.objects + optic_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for o in scene.objects:
            if o.animation_data:
                for track in o.animation_data.nla_tracks:
                    track.mute = track.name != 'Idle'
        scene.frame_set(0)
    print('TOR_MINI_MOUNT_OK:', weapon, count, 'sampled poses; actual rail contact, emitter ray, weapon/mechanisms and', len(hands), 'review-hand meshes; runtime/visual review separate')


if __name__ == '__main__':
    check_laser_mount(sys.argv[sys.argv.index('--') + 1])
