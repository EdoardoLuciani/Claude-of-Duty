"""Weapon-local runtime curves and read-only validation of stock glTF output."""
import json
import math
import struct
import bpy


def consolidate_static_surfaces(asset):
    """Join only nonmoving assemblies, after saving the editable source.

    Receiver, handguard and optic share the rig's transform in every clip.
    Blender's native exporter batches their identical material slots; the lens
    remains its own transparent primitive. The rotated stock keeps its native
    local tessellation and normals without a bind-space conversion. Mechanisms,
    pouches and belt are untouched.
    """
    objects=[bpy.data.objects[name] for name in ('receiver_mesh','handguard_mesh','optic_mesh')]
    rig=bpy.data.objects['EVOLYS_RIG']
    for obj in objects:
        assert obj.name in asset.objects and not obj.animation_data
        assert obj.parent.parent==rig and not obj.parent.animation_data
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    merged=bpy.context.object
    world=merged.matrix_world.copy();merged.parent=rig
    merged.matrix_parent_inverse=rig.matrix_world.inverted();merged.matrix_world=world
    merged.name='static_surfaces'


def prepare_export_actions(asset, clips):
    """Preserve the historical 120 Hz NLA lattice in native Actions curves.

    The preview has already been saved. Its sparse Bezier poses stay editable.
    Runtime used integer frames through ceil(end), with that held final sample
    timestamped at the exact clip end. Visibility uses the same lattice.
    """
    scene=bpy.context.scene
    objects=[o for o in asset.objects if o.animation_data]
    for o in objects:
        o.rotation_mode='QUATERNION'
        o.animation_data.action=None
        o.animation_data.use_nla=False
        for track in o.animation_data.nla_tracks:track.mute=True
    bpy.context.view_layer.update()
    for o in objects:
        for track in o.animation_data.nla_tracks:
            strip=track.strips[0]
            action=strip.action.copy();strip.action=action
            end=clips[track.name]['frames'][1]
            frames=list(range(math.ceil(end)+1))
            for layer in action.layers:
                for action_strip in layer.strips:
                    for bag in action_strip.channelbags:
                        # NLA exported explicit reset channels on every control.
                        targets=[('',o)]
                        if o.type=='ARMATURE':
                            targets += [(pb.path_from_id()+'.',pb) for pb in o.pose.bones]
                        for prefix,target in targets:
                            for path in ('location','rotation_quaternion','scale'):
                                data_path=prefix+path
                                if not any(c.data_path==data_path for c in bag.fcurves):
                                    for i,value in enumerate(getattr(target,path)):
                                        curve=bag.fcurves.new(data_path,index=i)
                                        curve.keyframe_points.insert(0,value)
                        groups=dict.fromkeys(curve.data_path for curve in bag.fcurves)
                        for path in groups:
                            curves=sorted((c for c in bag.fcurves if c.data_path==path),key=lambda c:c.array_index)
                            values=[[c.evaluate(frame) for c in curves] for frame in frames]
                            # Match the stock sampled exporter's existing constant-
                            # channel reduction, including endpoint STEP values.
                            constant=all(max(row[i] for row in values)-min(row[i] for row in values)<.0001 for i in range(len(curves)))
                            indices=[0,len(frames)-1] if constant else range(len(frames))
                            for i,curve in enumerate(curves):
                                curve.keyframe_points.clear();curve.keyframe_points.add(len(indices))
                                curve.keyframe_points.foreach_set('co',[v for index in indices for v in (min(frames[index],end),values[index][i])])
                                for point in curve.keyframe_points:point.interpolation='CONSTANT' if constant or path.endswith('scale') else 'LINEAR'
                                curve.update()
            strip.action_frame_end=end;strip.frame_end=end
        o.scale=(1,1,1)
        if o.type=='ARMATURE':
            for pb in o.pose.bones:pb.matrix_basis.identity()
    scene.frame_set(0);bpy.context.view_layer.update()


def validate_export(path, clips):
    """Inspect, never rewrite, the native exporter product."""
    raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length])
    assert {a['name'] for a in doc['animations']}==set(clips)
    for animation in doc['animations']:
        duration=clips[animation['name']]['duration']
        expected=struct.unpack('<f',struct.pack('<f',duration))[0]
        for sampler in animation['samplers']:
            accessor=doc['accessors'][sampler['input']]
            # Native JSON bounds retain the source frame's double-precision
            # division; compare their exact float32 encoding to the actual data.
            assert struct.pack('<f',accessor['max'][0])==struct.pack('<f',duration),(animation['name'],accessor['max'])
            view=doc['bufferViews'][accessor['bufferView']]
            offset=28+length+view.get('byteOffset',0)+accessor.get('byteOffset',0)
            times=struct.unpack_from('<'+'f'*accessor['count'],raw,offset)
            assert times[0]==0 and times[-1]==expected
            assert all(a<b for a,b in zip(times,times[1:]))
        for channel in animation['channels']:
            if channel['target']['path']=='scale':
                assert animation['samplers'][channel['sampler']]['interpolation']=='STEP'
    return raw,doc
