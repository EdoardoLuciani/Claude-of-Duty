"""One-influence mechanical skin; magazines/rounds/case keep real mesh ownership."""
import math
import bpy
from mathutils import Matrix, Vector
from m4.animations import select_clip


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def build_skin(asset, parts, separate, clips):
    rig = bpy.data.objects['M4_RIG']
    names = ('receiver', 'handguard', 'stock', 'bolt', 'bolt_head',
             'charging_handle', 'trigger', 'dust_cover', 'mag_release')
    controls = [bpy.data.objects[name] for name in names]
    # Named static bones retain independently queryable exact iron surfaces.
    for mesh in separate:
        name = mesh.name
        mesh.name = name + ' geometry'
        helper = bpy.data.objects.new(name, None)
        asset.objects.link(helper)
        helper.parent = mesh.parent
        helper.matrix_parent_inverse = mesh.matrix_parent_inverse.copy()
        helper.matrix_basis = mesh.matrix_basis.copy()
        bpy.context.view_layer.update()
        world = mesh.matrix_world.copy()
        mesh.parent = helper
        mesh.matrix_world = world
        controls.append(helper)
    source_rest = {obj: (obj.location.copy(), obj.rotation_quaternion.copy()) for obj in parts}
    select_clip(parts, [], clips, 'Idle')
    for obj in parts:
        obj.animation_data.action = None
        obj.animation_data.use_nla = False
        obj.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    rest = {obj: rig.matrix_world.inverted() @ obj.matrix_world for obj in controls}
    basis = Matrix.Rotation(math.pi / 2, 4, 'X')
    bone_rest = {obj: matrix @ basis for obj, matrix in rest.items()}
    data = bpy.data.armatures.new('M4 mechanical bones')
    arm = bpy.data.objects.new('M4_SKIN', data)
    asset.objects.link(arm)
    arm.parent = rig
    active(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    for obj in controls:
        bone = data.edit_bones.new(obj.name)
        bone.head = rest[obj].translation
        bone.tail = bone.head + Vector((0, .01, 0))
        bone.matrix = bone_rest[obj]
        if obj.parent in controls:
            bone.parent = data.edit_bones[obj.parent.name]
    bpy.ops.object.mode_set(mode='OBJECT')
    for bone in arm.pose.bones:
        bone.rotation_mode = 'QUATERNION'
    surfaces = [obj for obj in asset.objects if obj.type == 'MESH' and obj.parent in controls]
    for obj in surfaces:
        parent = obj.parent
        obj.data = obj.data.copy()
        obj.vertex_groups.clear()
        group = obj.vertex_groups.new(name=parent.name)
        group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
        world = obj.matrix_world.copy()
        obj.parent = arm
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = world
    active(surfaces[0])
    for obj in surfaces:
        obj.select_set(True)
    bpy.ops.object.join()
    surface = bpy.context.object
    surface.name = 'receiver_mesh'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mod = surface.modifiers.new('Rigid mechanical skin', 'ARMATURE')
    mod.object = arm
    for obj in parts:
        obj.animation_data.use_nla = True
    scene = bpy.context.scene
    for name, info in clips.items():
        select_clip(parts, [], clips, name)
        arm.animation_data_create()
        action = bpy.data.actions.new(name + ' | mechanical skin')
        arm.animation_data.action = action
        arm.animation_data.use_nla = False
        previous = {}
        end = info['frames'][1]
        for frame in range(math.ceil(end) + 1):
            time = min(frame, end)
            scene.frame_set(math.floor(time), subframe=time - math.floor(time))
            for obj in controls:
                bone = arm.pose.bones[obj.name]
                rest_local = bone_rest[obj]
                local = obj.matrix_parent_inverse @ obj.matrix_basis @ basis
                if obj.parent in controls:
                    rest_local = bone_rest[obj.parent].inverted() @ rest_local
                    local = basis.inverted() @ local
                bone.matrix_basis = rest_local.inverted() @ local
                q = bone.rotation_quaternion
                if obj.name in previous:
                    q.make_compatible(previous[obj.name])
                previous[obj.name] = q.copy()
                for path in ('location', 'rotation_quaternion', 'scale'):
                    bone.keyframe_insert(path, frame=time, group=obj.name)
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = 'CONSTANT' if curve.data_path.endswith('.scale') else 'LINEAR'
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, action)
        strip.action_frame_start = 0
        strip.action_frame_end = end
        strip.extrapolation = 'HOLD'
        arm.animation_data.action = None
        track.mute = True
    arm.animation_data.use_nla = True
    # Do not export duplicate animated source controls alongside their bones.
    source = bpy.data.collections.new('M4 | export bake controls (not exported)')
    scene.collection.children.link(source)
    for obj in controls:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        source.objects.link(obj)
    # Export from invertible rest seats, not Idle's hidden spare/case scales.
    for obj in parts:
        for track in obj.animation_data.nla_tracks:
            track.mute = True
        obj.location, obj.rotation_quaternion = source_rest[obj]
        obj.scale = (1, 1, 1)
    for track in arm.animation_data.nla_tracks:
        track.mute = True
    for bone in arm.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    scene.frame_set(0)
    bpy.context.view_layer.update()
    return arm
