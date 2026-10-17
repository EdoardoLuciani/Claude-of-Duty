"""Runtime-only preparation; editable poses and shared review skins stay unchanged."""
import math
import bpy
import numpy as np

FPS = 120
# The stock sampled exporter uses this reduction threshold, not a validation tolerance.
CONSTANT_CHANNEL_RANGE = .0001


def prepare_export_actions(objects, clips):
    """Bake the historical evaluated 120 Hz lattice into native Actions.

    The old NLA export sampled through ceil(duration * 120), then moved only
    that last sample's time to the exact endpoint. Preserve that held value,
    including 60/950 Fire, rather than resampling the fractional endpoint.
    Local evaluated TRS keeps child resets independent of parent visibility,
    as in the historical per-object NLA sampler.
    """
    scene = bpy.context.scene
    controls = [obj for obj in objects if obj.animation_data]
    rest = {obj: (obj.location.copy(), obj.rotation_quaternion.copy(), obj.scale.copy()) for obj in controls}
    samples = {}
    for name, clip in clips.items():
        for obj in controls:
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name
        values = {obj: [] for obj in controls}
        for frame in range(math.ceil(clip['frames'][1]) + 1):
            scene.frame_set(frame)
            for obj in controls:
                values[obj].append(obj.matrix_basis.decompose())
        samples[name] = values
    for obj in controls:
        for track in obj.animation_data.nla_tracks:
            track.mute = True
            strip = track.strips[0]
            action = bpy.data.actions.new(track.name + ' | runtime | ' + obj.name)
            obj.animation_data.action = action
            end = clips[track.name]['frames'][1]
            # FCurve frame coordinates are float32. Pick the adjacent frame if
            # rounding it first would change the final float32 seconds (Draw).
            endpoint = np.float32(end)
            seconds = np.float32(clips[track.name]['duration'])
            if np.float32(float(endpoint) / FPS) != seconds:
                direction = -np.inf if float(endpoint) / FPS > float(seconds) else np.inf
                endpoint = np.nextafter(endpoint, np.float32(direction))
            assert np.float32(float(endpoint) / FPS) == seconds
            endpoint = float(endpoint)
            values = samples[track.name][obj]
            for channel, path in enumerate(('location', 'rotation_quaternion', 'scale')):
                rows = [tuple(value[channel]) for value in values]
                # Match the historical sampled exporter's constant reduction.
                constant = all(max(row[i] for row in rows) - min(row[i] for row in rows) < CONSTANT_CHANNEL_RANGE
                               for i in range(len(rows[0])))
                indices = [0, len(rows) - 1] if constant else range(len(rows))
                for index in indices:
                    setattr(obj, path, rows[index])
                    obj.keyframe_insert(path, frame=min(index, endpoint), group=obj.name)
                bag = action.layers[0].strips[0].channelbag(action.slots[0])
                for curve in bag.fcurves:
                    if curve.data_path != path:
                        continue
                    for point in curve.keyframe_points:
                        point.interpolation = 'CONSTANT' if path == 'scale' or (constant and rows[0] == rows[-1]) else 'LINEAR'
            strip.action = action
            strip.action_slot = action.slots[0]
            strip.action_frame_end = endpoint
            strip.frame_end = endpoint
        obj.animation_data.action = None
        obj.location, obj.rotation_quaternion, obj.scale = rest[obj]
    scene.frame_set(0)
    bpy.context.view_layer.update()
