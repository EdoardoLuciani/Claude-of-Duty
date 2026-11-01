"""Unmodified stock Actions export of the atlas-backed mechanical skin."""
import json
import struct
import bpy


def sample_controls(asset):
    """Native 60 Hz Actions, without force-sampling STEP bone scales to LINEAR.

    The editable sparse control actions were already saved. Sample the same
    lattice as the previous P320 exporter, then let stock Actions export both
    these controls and the mechanical bone actions without post-export repair.
    """
    scene = bpy.context.scene
    objects = [obj for obj in asset.objects if obj.type == 'EMPTY' and obj.animation_data
               and obj.animation_data.nla_tracks]
    tracks = {obj: {track.name: track for track in obj.animation_data.nla_tracks}
              for obj in objects}
    paths = {}
    for obj in objects:
        paths[obj] = {}
        for name, track in tracks[obj].items():
            action = track.strips[0].action
            paths[obj][name] = {curve.data_path for layer in action.layers for strip in layer.strips
                               for bag in strip.channelbags for curve in bag.fcurves}
    samples = {}
    for name in tracks[objects[0]]:
        end = int(tracks[objects[0]][name].strips[0].action_frame_end)
        for obj in objects:
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name
        samples[name] = []
        for frame in range(end + 1):
            scene.frame_set(frame)
            samples[name].append([(obj.location.copy(),
                (obj.rotation_quaternion if obj.rotation_mode == 'QUATERNION' else obj.rotation_euler).copy(),
                obj.scale.copy()) for obj in objects])
    for name, frames in samples.items():
        for index, obj in enumerate(objects):
            action = bpy.data.actions.new(name + ' | sampled ' + obj.name)
            obj.animation_data.use_nla = False
            obj.animation_data.action = action
            rotation = 'rotation_quaternion' if obj.rotation_mode == 'QUATERNION' else 'rotation_euler'
            for frame, values in enumerate(frames):
                obj.location, q, obj.scale = values[index]
                setattr(obj, rotation, q)
                for path in sorted(paths[obj][name]):
                    obj.keyframe_insert(path, frame=frame)
            for layer in action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for key in curve.keyframe_points:
                                key.interpolation = 'CONSTANT' if curve.data_path == 'scale' else 'LINEAR'
            strip = tracks[obj][name].strips[0]
            strip.action = action
            strip.action_slot = action.slots[0]
            obj.animation_data.action = None
            obj.animation_data.use_nla = True
            tracks[obj][name].mute = True
    for obj in objects:
        tracks[obj]['Idle'].mute = False
    scene.frame_set(0)
    bpy.context.view_layer.update()


def export_asset(asset, coords, output):
    sample_controls(asset)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in asset.objects:
        if obj != coords:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(output / 'p320-compact.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS', export_merge_animation='NLA_TRACK',
        export_anim_single_armature=False,
        export_frame_range=False, export_force_sampling=False,
        export_optimize_animation_keep_anim_object=True,
        export_sampling_interpolation_fallback='LINEAR', export_extras=True, export_yup=True,
        export_materials='EXPORT', export_cameras=False, export_lights=False,
    )
    # Read-only validation; never repair the GLB, textures or animation samplers.
    raw = (output / 'p320-compact.glb').read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + length])
    for animation in doc['animations']:
        for channel in animation['channels']:
            if channel['target']['path'] == 'scale':
                assert animation['samplers'][channel['sampler']]['interpolation'] == 'STEP'
    primitives = [p for node in doc['nodes'] if 'mesh' in node
                  for p in doc['meshes'][node['mesh']]['primitives']]
    stats = {
        'triangles': sum(doc['accessors'][p['indices']]['count'] // 3 for p in primitives),
        'vertices': sum(doc['accessors'][p['attributes']['POSITION']]['count'] for p in primitives),
        'meshes': len(doc['meshes']), 'primitives': len(primitives),
        'materials': len(doc['materials']), 'textureImages': len(doc['images']),
        'joints': len(doc['skins'][0]['joints']), 'bytes': len(raw),
    }
    assert stats['primitives'] == 1 and stats['materials'] == 1, stats
    assert stats['triangles'] < 30000, stats
    return stats
