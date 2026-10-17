"""AX338-only source preparation; stock export products are read-only."""
import json
import math
import struct
import bpy


def prepare_export_actions(parts, clips):
    """Preserve the NLA 120 Hz lattice and held ceil-frame endpoints.

    The saved preview retains fitted LINEAR and free-motion BEZIER intervals.
    Runtime visibility uses the historical integer samples, not sparse beats.
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
                                    point.interpolation = 'CONSTANT' if path == 'scale' or constant else 'LINEAR'
                                curve.update()
            strip.action_frame_end = end
            strip.frame_end = end
        obj.animation_data.action = None
        obj.location, obj.rotation_quaternion = rest[obj]
        obj.scale = (1, 1, 1)
    scene.frame_set(0)
    bpy.context.view_layer.update()


def validate_export(path, clips):
    raw=path.read_bytes()
    length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length])
    assert {a['name'] for a in doc['animations']}==set(clips)
    for animation in doc['animations']:
        duration=clips[animation['name']]['duration']
        for sampler in animation['samplers']:
            accessor=doc['accessors'][sampler['input']]
            assert abs(accessor['max'][0]-duration)<1e-7,(animation['name'],accessor['max'])
        for channel in animation['channels']:
            sampler=animation['samplers'][channel['sampler']]
            if channel['target']['path']=='scale':
                assert sampler['interpolation']=='STEP',(animation['name'],channel)
            elif sampler['interpolation']=='STEP':
                accessor=doc['accessors'][sampler['output']]
                view=doc['bufferViews'][accessor['bufferView']]
                components=3 if accessor['type']=='VEC3' else 4
                offset=28+length+view.get('byteOffset',0)+accessor.get('byteOffset',0)
                values=struct.unpack_from('<'+'f'*(accessor['count']*components),raw,offset)
                assert all(values[i:i+components]==values[:components] for i in range(0,len(values),components)),(animation['name'],channel)
            else:
                assert sampler['interpolation']=='LINEAR',(animation['name'],channel)
    primitives=[p for n in doc['nodes'] if 'mesh' in n for p in doc['meshes'][n['mesh']]['primitives']]
    return {'triangles':sum(doc['accessors'][p['indices']]['count']//3 for p in primitives),'primitives':len(primitives),'materials':len(doc['materials']),'images':len(doc['images']),'bytes':len(raw)}
