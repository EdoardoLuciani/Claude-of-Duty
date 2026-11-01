"""Existing poses plus native 120 Hz Actions export curves, with STEP visibility."""
import math
import bpy
from m4.actions import author_actions

FPS = 120


def build_animations(root, asset, parts):
    rig, bolt, head, handle, trigger, cover, release, mag, spare, case, _, _ = parts
    clips, controls, hands = author_actions(
        root, asset, rig, parts, mag, spare, bolt, head, handle,
        trigger, cover, release, case,
    )
    return clips, parts + controls, hands


def select_clip(parts, hands, clips, name, frame=0):
    scene = bpy.context.scene
    for obj in parts + hands:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name
    scene.frame_start = 0
    scene.frame_end = math.ceil(clips[name]['frames'][1])
    scene.frame_set(frame)


def prepare_export_actions(parts, clips):
    """Bake the historical NLA sample lattice before native Actions export.

    Keep the editable Bezier poses in the saved preview. Runtime motion was
    sampled at integer frames, including a held frame 75 for Draw. Give that
    final sample its exact 74.4 frame timestamp here, not in the exported GLB.
    Visibility uses that same lattice (not fractional source visibility keys).
    """
    scene = bpy.context.scene
    for obj in parts:
        for track in obj.animation_data.nla_tracks:
            track.mute = True
        obj.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    rest = {obj: (obj.location.copy(), obj.rotation_quaternion.copy()) for obj in parts}
    for obj in parts:
        for track in obj.animation_data.nla_tracks:
            strip = track.strips[0]
            action = strip.action.copy()
            strip.action = action
            end = clips[track.name]['frames'][1]
            frames = list(range(math.ceil(end) + 1))
            for layer in action.layers:
                for action_strip in layer.strips:
                    for bag in action_strip.channelbags:
                        # NLA sampling emitted all TRS channels, including explicit
                        # resets on the finger controls. Keep those reset channels.
                        for path in ('location', 'rotation_quaternion', 'scale'):
                            if not any(curve.data_path == path for curve in bag.fcurves):
                                for index, value in enumerate(getattr(obj, path)):
                                    curve = bag.fcurves.new(path, index=index)
                                    curve.keyframe_points.insert(0, value)
                        for path in ('location', 'rotation_quaternion', 'scale'):
                            curves = sorted(
                                (curve for curve in bag.fcurves if curve.data_path == path),
                                key=lambda curve: curve.array_index,
                            )
                            if not curves:
                                continue
                            values = [[curve.evaluate(frame) for curve in curves] for frame in frames]
                            # Same constant-channel reduction as the NLA exporter.
                            constant = all(max(row[i] for row in values) - min(row[i] for row in values) < .0001
                                           for i in range(len(curves)))
                            indices = [0, len(frames) - 1] if constant else range(len(frames))
                            for i, curve in enumerate(curves):
                                curve.keyframe_points.clear()
                                curve.keyframe_points.add(len(indices))
                                curve.keyframe_points.foreach_set('co', [
                                    component for index in indices
                                    for component in (min(frames[index], end), values[index][i])
                                ])
                                for point in curve.keyframe_points:
                                    point.interpolation = 'CONSTANT' if path == 'scale' else 'LINEAR'
                                curve.update()
            strip.action_frame_end = end
            strip.frame_end = end
        obj.animation_data.action = None
        obj.location, obj.rotation_quaternion = rest[obj]
        obj.scale = (1, 1, 1)
    scene.frame_set(0)
    bpy.context.view_layer.update()
