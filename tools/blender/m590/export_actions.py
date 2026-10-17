"""Prepare the historical 120 Hz motion and fractional hull visibility in Blender.

The editable actions and review skins are saved before this stage. Only runtime
copy actions change; the stock Actions exporter reads their TRS curves directly,
so a hidden zero-scale hull never loses its authored quaternion to decomposition.
"""
import math
import struct
import bpy

FPS = 120


def float32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def prepare_export_actions(copies, clips):
    scene = bpy.context.scene
    for source, clone in copies.items():
        if not source.animation_data:
            continue
        clone.animation_data_clear()
        clone.animation_data_create()
        for track in source.animation_data.nla_tracks:
            duration = clips[track.name]['duration']
            end = duration * FPS
            action = track.strips[0].action.copy()
            # NLA used integer frames through ceil(end), with a held final pose.
            # Place that same last value at the exact endpoint before exporting.
            frames = list(range(math.ceil(end) + 1))
            for layer in action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for path in ('location', 'rotation_quaternion', 'scale'):
                            if not any(c.data_path == path for c in bag.fcurves):
                                for index, value in enumerate(getattr(clone, path)):
                                    curve = bag.fcurves.new(path, index=index)
                                    curve.keyframe_points.insert(0, value)
                            curves = sorted((c for c in bag.fcurves if c.data_path == path),
                                            key=lambda c: c.array_index)
                            sample_frames = frames
                            key_frames = [min(frame, end) for frame in frames]
                            if source.name == 'SOURCE_shell_insert' and path == 'scale' and track.name.startswith('Reload'):
                                appear, hide = ((.44, .70) if track.name == 'Reload_Empty' else (.34, .84))
                                # Blender stores frames as float32. Round seconds
                                # first, then convert to frames, so native export
                                # retains the exact historical float32 STEP beats.
                                key_frames = [float32(t) * FPS for t in
                                              (0, appear * duration, hide * duration, duration)]
                                values = [[v] * 3 for v in (0, 1, 0, 0)]
                            else:
                                values = [[curve.evaluate(frame) for curve in curves] for frame in sample_frames]
                            # Match stock NLA's constant-channel reduction; this
                            # is an exporter criterion, not a validation allowance.
                            constant = all(max(v[i] for v in values) - min(v[i] for v in values) < .0001
                                           for i in range(len(curves)))
                            if constant:
                                key_frames = [key_frames[0], key_frames[-1]]
                                values = [values[0], values[-1]]
                            for index, curve in enumerate(curves):
                                curve.keyframe_points.clear()
                                curve.keyframe_points.add(len(key_frames))
                                curve.keyframe_points.foreach_set('co', [component
                                    for frame, value in zip(key_frames, values)
                                    for component in (frame, value[index])])
                                for point in curve.keyframe_points:
                                    point.interpolation = 'CONSTANT' if path == 'scale' or constant else 'LINEAR'
                                curve.update()
            native_track = clone.animation_data.nla_tracks.new()
            native_track.name = track.name
            native_strip = native_track.strips.new(track.name, 0, action)
            native_strip.action_frame_start = 0
            native_strip.action_frame_end = end
            native_strip.frame_end = end
            native_track.mute = True
        clone.animation_data.action = None
        clone.scale = (1, 1, 1)
    scene.frame_set(0)
    bpy.context.view_layer.update()


def validate_export(doc, binary, clips):
    """Read-only output assertions; never rewrite GLB JSON or binary buffers."""
    assert {a['name'] for a in doc['animations']} == set(clips)
    for animation in doc['animations']:
        duration = clips[animation['name']]['duration']
        for sampler in animation['samplers']:
            assert abs(doc['accessors'][sampler['input']]['max'][0] - duration) < 1e-7
        for channel in animation['channels']:
            if channel['target']['path'] == 'scale':
                sampler = animation['samplers'][channel['sampler']]
                assert sampler['interpolation'] == 'STEP'
                if doc['nodes'][channel['target']['node']]['name'] == 'shell_insert' and animation['name'].startswith('Reload'):
                    appear, hide = ((.44, .70) if animation['name'] == 'Reload_Empty' else (.34, .84))
                    acc = doc['accessors'][sampler['input']]
                    view = doc['bufferViews'][acc['bufferView']]
                    times = struct.unpack_from('<4f', binary, view.get('byteOffset', 0) + acc.get('byteOffset', 0))
                    assert times == tuple(float32(t) for t in (0, appear * duration, hide * duration, duration)), times
