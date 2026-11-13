"""Bake shared review skins from actual runtime skin matrices, never duplicate IK."""
import base64
import json
import math
from array import array

import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

LABEL = 'MCX | authored hands (shared appearance)'
TEXT = 'MCX runtime hand reference'


def matrix(values):
    return Matrix([values[i:i+4] for i in range(0,16,4)]).transposed()


def author_review_hands(root, output):
    metadata = json.loads((output/'review/runtime-hands.json').read_text())
    values = array('f'); values.frombytes((output/'review/runtime-hands.bin').read_bytes())
    collection = bpy.data.collections.new(LABEL)
    bpy.context.scene.collection.children.link(collection)
    with bpy.data.libraries.load(str(root/'assets/player/arms/player-arms.blend'),link=False) as (available,loaded):
        loaded.objects = list(available.objects)
    source = next(o for o in loaded.objects if o.type == 'ARMATURE')
    source_world = source.matrix_world.copy()
    meshes = [o for o in loaded.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
    inverse_source = source_world.inverted()
    for side, transform in zip(('left','right'), metadata['transforms']):
        arm = source.copy(); arm.data = source.data.copy(); arm.animation_data_clear()
        arm.name = 'MCX_arm_'+side; arm.parent = None
        # Runtime wrist/elbow controls are independent; do not inherit the
        # forearm's nonuniform reach scale into the glove or introduce shear.
        for bone in arm.data.bones: bone.inherit_scale = 'NONE'
        collection.objects.link(arm); arm.matrix_world = matrix(transform) @ source_world
        for obj in meshes:
            clone = obj.copy(); clone.data = obj.data; clone.name = 'MCX_'+side+'_'+obj.name
            collection.objects.link(clone); clone.parent = arm
            clone.matrix_world = matrix(transform) @ obj.matrix_world
            for modifier in clone.modifiers:
                if modifier.type == 'ARMATURE': modifier.object = arm
        arm.animation_data_create()
        for track in metadata['tracks']:
            action = bpy.data.actions.new(track['name']+' | '+arm.name)
            slot = action.slots.new(id_type='OBJECT',name=arm.name)
            bag = action.layers.new('Runtime skin pose').strips.new(type='KEYFRAME').channelbag(slot,ensure=True)
            channels = {name:[[] for _ in range(10)] for name in metadata['bones']}
            previous = {}
            stride = 2*len(metadata['bones'])*16 + 2*len(metadata['points'])*3
            side_index = 0 if side == 'left' else 1
            for sample,time in enumerate(track['times']):
                offset = track['offset'] + sample*stride + side_index*len(metadata['bones'])*16
                desired = {}
                for i,name in enumerate(metadata['bones']):
                    skin = matrix(values[offset+i*16:offset+(i+1)*16])
                    desired[name] = inverse_source @ skin @ source_world @ arm.data.bones[name].matrix_local
                for bone in arm.pose.bones:
                    parent = {'parent_matrix':desired[bone.parent.name], 'parent_matrix_local':bone.parent.bone.matrix_local} if bone.parent else {}
                    basis = bone.bone.convert_local_to_pose(desired[bone.name],bone.bone.matrix_local,invert=True,**parent)
                    location,rotation,scale = basis.decompose()
                    if bone.name in previous and rotation.dot(previous[bone.name]) < 0: rotation.negate()
                    previous[bone.name] = rotation.copy()
                    for channel,value in zip(channels[bone.name],(*location,*rotation,*scale)):
                        channel.extend((time*60,value))
            for bone in arm.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                for i,coordinates in enumerate(channels[bone.name]):
                    prop,component = ('location',i) if i < 3 else ('rotation_quaternion',i-3) if i < 7 else ('scale',i-7)
                    curve = bag.fcurves.new(data_path=f'pose.bones["{bone.name}"].{prop}',index=component)
                    curve.keyframe_points.add(len(track['times']))
                    curve.keyframe_points.foreach_set('co',coordinates)
                    for key in curve.keyframe_points: key.interpolation = 'LINEAR'
                    curve.update()
            nla = arm.animation_data.nla_tracks.new(); nla.name = track['name']
            strip = nla.strips.new(track['name'],0,action); strip.action_slot = slot
            strip.action_frame_start = 0; strip.action_frame_end = max(1,track['times'][-1]*60)
            strip.extrapolation = 'HOLD'; nla.mute = track['name'] != 'Idle'
    for obj in loaded.objects: bpy.data.objects.remove(obj,do_unlink=True)
    # Store independent runtime vertex receipts in the editable file. No external
    # cache/old blend is needed to check a saved source's baked deformation.
    reference = array('f')
    stride = 2*len(metadata['bones'])*16 + 2*len(metadata['points'])*3
    for track in metadata['tracks']:
        offset = track['offset']; track['offset'] = len(reference)
        for sample in range(len(track['times'])):
            start = offset+sample*stride+2*len(metadata['bones'])*16
            reference.extend(values[start:start+2*len(metadata['points'])*3])
    metadata['vertices'] = {}
    for obj in collection.objects:
        if obj.type != 'MESH': continue
        lookup = KDTree(len(obj.data.vertices))
        for vertex in obj.data.vertices: lookup.insert(vertex.co,vertex.index)
        lookup.balance()
        side_index = 0 if obj.name.startswith('MCX_left_') else 1
        inverse = (matrix(metadata['transforms'][side_index]).inverted() @ obj.matrix_world).inverted()
        indices = []
        for point_index,point in enumerate(metadata['points']):
            if obj.name != 'MCX_'+('left' if side_index == 0 else 'right')+'_'+point['name']: continue
            _,index,distance = lookup.find(inverse @ Vector(point['source']))
            assert distance < 1e-6, ('runtime/source skin mismatch',obj.name,distance)
            indices.append((point_index,index))
        assert indices, ('missing runtime skin references',obj.name)
        metadata['vertices'][obj.name] = indices
    metadata['reference'] = base64.b64encode(reference.tobytes()).decode('ascii')
    bpy.data.texts.new(TEXT).write(json.dumps(metadata))
    bpy.context.scene['review_hands'] = 'Runtime Viewmodel/MCXAnimation, 120 Hz, hip stance without sway; Idle_ADS; Draw/Holster are review-only. Stock_Fold retains Idle hands.'
    bpy.data.texts.new('MCX hand review - START HERE').write(
        'Review-only shared skins, never exported in the weapon GLB.\n'
        'Use tools/blender/mcx/review_hands.py: select_review_clip(name) enables matching weapon/arm tracks and sets the timeline.\n'
        'Tracks: '+', '.join(track['name'] for track in metadata['tracks'])+'\n'
        'Fire uses native clip time (gameplay runs it faster); Stock_Fold retains the Idle hold. No procedural sway/bob is baked.\n'
        'Rebuild after changing runtime hand code; tools/build-assets.ts tracks those inputs. See assets/weapons/mcx-virtus/README.md.\n')
    select_review_clip('Idle')


def review_tracks():
    return json.loads(bpy.data.texts[TEXT].as_string())['tracks']


def select_review_clip(name):
    track = next(track for track in review_tracks() if track['name'] == name)
    collection = bpy.data.collections[LABEL]
    scene = bpy.context.scene
    for obj in scene.objects:
        if obj.animation_data:
            obj.animation_data.action = None
            for nla in obj.animation_data.nla_tracks:
                nla.mute = nla.name != (name if obj.name in collection.objects else track['source'])
                # Source Idle has one key: keep its real pivots/hidden parts
                # held through review-only Draw/Holster, not zero RNA defaults.
                if nla.name == 'Idle':
                    for strip in nla.strips: strip.extrapolation = 'HOLD'
    scene.frame_start = 0; scene.frame_end = max(1,math.ceil(track['times'][-1]*scene.render.fps))
    scene.frame_set(0)


def check_review_hands():
    metadata = json.loads(bpy.data.texts[TEXT].as_string())
    reference = array('f'); reference.frombytes(base64.b64decode(metadata['reference']))
    collection = bpy.data.collections[LABEL]
    arms = [obj for obj in collection.objects if obj.type == 'ARMATURE']
    assert len(arms) == 2, 'both runtime review arms are required'
    assert {obj.name for obj in collection.objects if obj.type == 'MESH'} == set(metadata['vertices']), 'missing review skin'
    for arm in arms:
        assert {track.name for track in arm.animation_data.nla_tracks} == {track['name'] for track in metadata['tracks']}, 'missing review clip'
    assert not any(obj.name in bpy.data.collections['MCX VIRTUS | authored components'].objects for obj in collection.objects), 'review arms entered weapon export collection'
    select_review_clip('Idle'); bpy.context.view_layer.update()
    idle = {obj.name:obj.matrix_world.copy() for obj in bpy.data.collections['MCX VIRTUS | authored components'].objects if obj.type == 'EMPTY' and obj.animation_data}
    maximum = 0; poses = 0; worst = None
    for track in metadata['tracks']:
        select_review_clip(track['name'])
        for sample,time in enumerate(track['times']):
            frame = time*60; bpy.context.scene.frame_set(int(frame),subframe=frame%1)
            if track['source'] == 'Idle':
                for name,rest in idle.items():
                    assert max(abs(bpy.data.objects[name].matrix_world[i][j]-rest[i][j]) for i in range(4) for j in range(4)) < 1e-7, ('review gesture lost weapon Idle',track['name'],time,name)
            for obj in collection.objects:
                if obj.type != 'MESH': continue
                evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()); mesh = evaluated.to_mesh()
                side = 0 if obj.name.startswith('MCX_left_') else 1
                offset = track['offset']+(sample*2+side)*len(metadata['points'])*3
                for point,index in metadata['vertices'][obj.name]:
                    error = (evaluated.matrix_world @ mesh.vertices[index].co - Vector(reference[offset+point*3:offset+point*3+3])).length
                    assert math.isfinite(error), ('nonfinite review skin',obj.name,index)
                    if error > maximum:
                        maximum = error; worst = (track['name'],time,obj.name,index,error)
                evaluated.to_mesh_clear()
            poses += 1
    print('MCX_RUNTIME_HANDS_PARITY:',poses,'120Hz poses;',2*len(metadata['points']),'skin points per pose; maximum drift',maximum,'m',worst)
    # Stock glTF export drops sub-1e-4 skin influences (e.g. a 3.61e-5 fore
    # weight on the sleeve). Preserve the shared source weights; bound that
    # measured export difference plus float32 pose decomposition to 5 microns.
    assert maximum < 5e-6, ('baked/runtime hand drift',worst)
