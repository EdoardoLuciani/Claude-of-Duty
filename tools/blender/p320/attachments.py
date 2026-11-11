"""Physical checks against the available shared optics, never absent slot assets."""
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

ROOT = Path(__file__).resolve().parents[3]


def tree(objects, depsgraph=None):
    vertices, faces = [], []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph) if depsgraph else obj
        mesh = evaluated.to_mesh() if depsgraph else obj.data
        start = len(vertices)
        vertices.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        faces.extend(tuple(start + i for i in p.vertices) for p in mesh.polygons)
        if depsgraph:
            evaluated.to_mesh_clear()
    return BVHTree.FromPolygons(vertices, faces)


def optic_geometry():
    result = {}
    for id, directory in [('rmr', 'trijicon-rmr'), ('acog', 'trijicon-acog'),
                          ('scope', 'schmidt-bender-pm-ii')]:
        path = ROOT / 'assets/attachments' / directory / (id + '.blend')
        assert path.exists(), 'Build the available shared optic first: ' + str(path)
        with bpy.data.libraries.load(str(path), link=False) as (source, loaded):
            loaded.objects = source.objects
        for obj in loaded.objects:
            bpy.context.scene.collection.objects.link(obj)
        bpy.context.view_layer.update()
        base = next(o for o in loaded.objects if o.name.startswith('MOUNT_base'))
        inverse = base.matrix_world.inverted()
        vertices, faces = [], []
        for obj in loaded.objects:
            if obj.type != 'MESH':
                continue
            start = len(vertices)
            transform = inverse @ obj.matrix_world
            vertices.extend(transform @ v.co for v in obj.data.vertices)
            faces.extend(tuple(start + i for i in p.vertices) for p in obj.data.polygons)
        result[id] = vertices, faces
        for obj in loaded.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    return result


def check_sight_emission(surface):
    """Sample the baked map through each real front-facing inset, not its bounds."""
    atlas = bpy.data.images['P320_emission']
    width, height = atlas.size
    geometry = tree([surface])
    for x, y, z in [(-.0048, -.03655, .0531), (.0048, -.03655, .0531), (0, .10925, .0528)]:
        origin = surface.matrix_world @ Vector((x, y - .002, z))
        direction = surface.matrix_world.to_3x3() @ Vector((0, 1, 0))
        hit, _, face, _ = geometry.ray_cast(origin, direction, .003)
        assert hit is not None, 'missing SIGLITE inset surface'
        polygon = surface.data.polygons[face]
        vertices = [surface.matrix_world @ surface.data.vertices[i].co for i in polygon.vertices]
        coords = [Vector((*surface.data.uv_layers[0].data[i].uv, 0)) for i in polygon.loop_indices]
        uv = barycentric_transform(hit, *vertices, *coords)
        pixel = (int(uv.y * height) * width + int(uv.x * width)) * 4
        red, green, _ = atlas.pixels[pixel:pixel + 3]
        assert green > .1 and green > red * 1.5, ('SIGLITE emission lost in atlas', x, y, green)
    print('P320_SIGLITE_OK: all three inset centres retain baked green emission')


def check_mounts(clips):
    scene = bpy.context.scene
    rig = bpy.data.objects['P320_RIG']
    slide = bpy.data.objects['slide']
    mount = bpy.data.objects['MOUNT_optic']
    for obj, part in [(mount, 'slide'), (bpy.data.objects['MOUNT_muzzle'], 'barrel'),
                      (bpy.data.objects['MOUNT_rail'], 'frame')]:
        assert obj.parent_type == 'BONE' and obj.parent_bone == part, (obj.name, 'must export under mechanical bone')
    optics = optic_geometry()
    sources = [o for o in bpy.data.collections['P320 | high bake source (not exported)'].objects if o.type == 'MESH']
    # Rail/foot contact is intentional; no other optic/weapon intersection is.
    body = [o for o in sources if not o.name.startswith(('Mark |', 'Optic bridge | rail deck'))]
    shroud = bpy.data.objects['Slide | chamfered Nitron shell']
    thread = bpy.data.objects['Barrel | external muzzle thread']
    hands = [o for o in bpy.data.collections['P320 | authored hands (shared appearance)'].objects if o.type == 'MESH']
    samples = 0
    for name, info in clips.items():
        for obj in scene.objects:
            if not obj.animation_data:
                continue
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name
        end = info['frames'][1]
        for frame in sorted(set([0, end, *range(0, end + 1, 12), *([2, 4, 7] if name in ('Fire', 'Last_Shot') else [])])):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            assert not tree([shroud]).overlap(tree([thread])), (name, frame, 'thread/slide')
            weapon = tree(body)
            hand_tree = tree(hands, bpy.context.evaluated_depsgraph_get())
            eject = bpy.data.objects['SOCKET_ejection'].matrix_world.translation
            direction = (slide.matrix_world.to_3x3() @ Vector((.82, -.24, .52))).normalized()
            for id, (vertices, faces) in optics.items():
                mounted = BVHTree.FromPolygons([mount.matrix_world @ v for v in vertices], faces)
                assert not weapon.overlap(mounted), (name, frame, id, 'optic/weapon collision')
                assert not hand_tree.overlap(mounted), (name, frame, id, 'optic/hand collision')
                # Conservative 9.56 mm casing envelope along the authored ejection axis.
                for offset in ((0,0,0),(.00478,0,0),(-.00478,0,0),(0,0,.00478),(0,0,-.00478)):
                    assert mounted.ray_cast(eject + Vector(offset), direction, .10)[0] is None, (name, frame, id, 'ejection corridor blocked')
            if name == 'Idle':
                # Ray from the rear aim datum to the front blade through the bridge.
                origin = rig.matrix_world @ Vector((0, -.026, .0537))
                direction = (rig.matrix_world.to_3x3() @ Vector((0, 1, 0))).normalized()
                bridge = tree([o for o in sources if o.name.startswith(('Optic plate |', 'Optic bridge |'))])
                assert bridge.ray_cast(origin, direction, .13)[0] is None, 'fixed iron sight ray blocked'
            samples += 1
    print(f'P320_MOUNTS_OK: {samples} clip samples x 3 optics, fixed iron ray, thread/slide and hand clearances; muzzle/rail datums only (no suppressor/laser assets)')
