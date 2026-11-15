"""Physical checks for the fixed irons and remaining attachment mounts."""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

import attachment_source


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


def attachment_geometry(id, output=None):
    """Mesh vertices/faces of a built attachment in its datum frame, plus the datum-frame
    position of its `output` socket; the loaded objects are removed again."""
    objects, base = attachment_source.load(id)
    inverse = base.matrix_world.inverted()
    vertices, faces = [], []
    for obj in objects:
        if obj.type != 'MESH':
            continue
        start = len(vertices)
        transform = inverse @ obj.matrix_world
        vertices.extend(transform @ v.co for v in obj.data.vertices)
        faces.extend(tuple(start + i for i in p.vertices) for p in obj.data.polygons)
    point = output and inverse @ attachment_source.named(objects, output).matrix_world.translation
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    return vertices, faces, point


def check_sight_emission(surface):
    """Sample each projected inset and check the rear housing stays neutral."""
    atlas = bpy.data.images['P320_emission']
    width, height = atlas.size
    geometry = tree([surface])
    for x, y, z in [(-.0048, -.03655, .0531), (.0048, -.03655, .0531), (0, .10925, .0528)]:
        origin = surface.matrix_world @ Vector((x, y - .002, z))
        direction = surface.matrix_world.to_3x3() @ Vector((0, 1, 0))
        hit, normal, _, _ = geometry.ray_cast(origin, direction, .006)
        assert hit is not None, 'missing SIGLITE host surface'
        # The bake projects along the host normal, including the sloped rear face.
        centre = surface.matrix_world @ Vector((x, y, z))
        hit, _, face, _ = geometry.ray_cast(centre + normal * .002, -normal, .006)
        assert hit is not None, 'missing projected SIGLITE inset'
        polygon = surface.data.polygons[face]
        vertices = [surface.matrix_world @ surface.data.vertices[i].co for i in polygon.vertices]
        coords = [Vector((*surface.data.uv_layers[0].data[i].uv, 0)) for i in polygon.loop_indices]
        uv = barycentric_transform(hit, *vertices, *coords)
        pixel = (int(uv.y * height) * width + int(uv.x * width)) * 4
        red, green, _ = atlas.pixels[pixel:pixel + 3]
        assert green > .1 and green > red * 1.5, ('SIGLITE emission lost in atlas', x, y, green)
        if x:
            origin = surface.matrix_world @ Vector((x + .0012, y - .002, z))
            hit, _, face, _ = geometry.ray_cast(origin, direction, .006)
            assert hit is not None, 'missing rear sight housing'
            polygon = surface.data.polygons[face]
            vertices = [surface.matrix_world @ surface.data.vertices[i].co for i in polygon.vertices]
            coords = [Vector((*surface.data.uv_layers['BaseColorUV'].data[i].uv, 0)) for i in polygon.loop_indices]
            uv = barycentric_transform(hit, *vertices, *coords)
            base = bpy.data.images['P320_base']
            pixel = (int(uv.y * base.size[1]) * base.size[0] + int(uv.x * base.size[0])) * 4
            red, green, _ = base.pixels[pixel:pixel + 3]
            assert green <= red * 1.2, ('SIGLITE green bleeds onto rear housing', x, red, green)
    print('P320_SIGLITE_OK: three green inset centres and neutral rear sight housing')


def check_mounts(clips):
    scene = bpy.context.scene
    rig = bpy.data.objects['P320_RIG']
    for obj, part in [(bpy.data.objects['MOUNT_muzzle'], 'barrel'),
                      (bpy.data.objects['MOUNT_rail'], 'frame')]:
        assert obj.parent_type == 'BONE' and obj.parent_bone == part, (obj.name, 'must export under mechanical bone')
    shroud = bpy.data.objects['Slide | chamfered Nitron shell']
    thread = bpy.data.objects['Barrel | external muzzle thread']
    samples = 0
    for name, info in clips.items():
        for obj in scene.objects:
            if not obj.animation_data:
                continue
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name
        end = info['frames'][1]
        for step in range(math.ceil(info['duration']*120)+1):
            frame=min(step/120*scene.render.fps,end)
            scene.frame_set(math.floor(frame),subframe=frame%1)
            bpy.context.view_layer.update()
            assert not tree([shroud]).overlap(tree([thread])), (name, frame, 'thread/slide')
            if name == 'Idle':
                # The bare slide must stay below the fixed SIGLITE aim ray.
                origin = rig.matrix_world @ Vector((0, -.026, .0537))
                direction = (rig.matrix_world.to_3x3() @ Vector((0, 1, 0))).normalized()
                assert tree([shroud]).ray_cast(origin, direction, .13)[0] is None, 'fixed iron sight ray blocked'
            samples += 1
    print(f'P320_MOUNTS_OK: {samples} 120Hz clip samples; fixed iron ray and thread/slide clearance (muzzle/laser sweeps run separately)')
