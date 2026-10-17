"""P320 rest-space rigid joining and unmodified stock Actions export."""
import json
import struct
import bpy


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def export_asset(asset, coords, parts, output):
    # The preview is already saved. NLA tracks describe clip groups, not a
    # blended scene. Disable evaluation while joining at explicit unit scale;
    # a hidden spare parent must never collapse its mesh during depsgraph work.
    for obj in parts:
        obj.animation_data.action = None
        obj.animation_data.use_nla = False
        for track in obj.animation_data.nla_tracks:
            track.mute = True
        obj.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    for parent in [bpy.data.objects['frame'], *parts[1:9]]:
        meshes = [obj for obj in asset.objects if obj.type == 'MESH' and obj.parent == parent]
        if not meshes:
            continue
        active(meshes[0])
        for obj in meshes:
            obj.select_set(True)
        bpy.ops.object.join()
        bpy.context.object.name = parent.name + '_mesh'
    bpy.ops.object.select_all(action='DESELECT')
    for obj in asset.objects:
        if obj != coords:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(output / 'p320-compact.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS', export_merge_animation='NLA_TRACK',
        export_frame_range=False, export_force_sampling=True,
        export_optimize_animation_keep_anim_object=True,
        export_sampling_interpolation_fallback='LINEAR', export_extras=True, export_yup=True,
        export_materials='EXPORT', export_cameras=False, export_lights=False,
    )
    # Read-only metadata collection. Never repair the exported document/buffers.
    raw = (output / 'p320-compact.glb').read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + length])
    for animation in doc['animations']:
        for channel in animation['channels']:
            if channel['target']['path'] == 'scale':
                assert animation['samplers'][channel['sampler']]['interpolation'] == 'STEP'
    stats = {'triangles': 0, 'vertices': 0, 'meshes': len(doc['meshes']),
             'primitives': 0, 'textureImages': len(doc['images'])}
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            stats['primitives'] += 1
            stats['triangles'] += doc['accessors'][primitive['indices']]['count'] // 3
            stats['vertices'] += doc['accessors'][primitive['attributes']['POSITION']]['count']
    return stats
