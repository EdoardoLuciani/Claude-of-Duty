"""Rigid weapon skin, sampled from the unchanged native object/hand actions."""
import math
import bpy
from mathutils import Matrix, Vector
from .animations import select_clip
from .surfaces import active


def build_skin(asset, parts, clips):
    rig = bpy.data.objects['P320_RIG']
    controls = [bpy.data.objects[name] for name in ('frame', 'slide', 'barrel',
        'trigger', 'slide_catch', 'magazine', 'magazine_spare',
        'magazine_round', 'magazine_spare_round')]
    select_clip(parts, [], clips, 'Idle')
    for obj in parts:
        obj.animation_data.action = None
        obj.animation_data.use_nla = False
        obj.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    rest = {obj: rig.matrix_world.inverted() @ obj.matrix_world for obj in controls}
    # Bone coordinates are game axes. Stock glTF's root-bone Y-up conversion
    # then preserves the old public part-local coordinates (and hand contacts).
    basis = Matrix.Rotation(math.pi / 2, 4, 'X')
    bone_rest = {obj: matrix @ basis for obj, matrix in rest.items()}
    data = bpy.data.armatures.new('P320 mechanical bones')
    arm = bpy.data.objects.new('P320_SKIN', data)
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
    surfaces = [obj for obj in asset.objects if obj.type == 'MESH']
    for obj in surfaces:
        parent = obj.parent
        # Spare UV/topology is shared until skinning; weights must not alias
        # another object's differently named joint table during the join.
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
    surface.name = 'P320_surface'
    # Apply the join object's transform so skin bind space is the armature space.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    surface.data.materials.clear()
    surface.data.materials.append(bpy.data.materials['P320 | baked unique PBR'])
    for poly in surface.data.polygons:
        poly.material_index = 0
    mod = surface.modifiers.new('Rigid mechanical skin', 'ARMATURE')
    mod.object = arm
    # Keep native names and sockets under the corresponding moving bone.
    for obj in list(asset.objects):
        if not obj.name.startswith('SOCKET_') or obj.parent not in controls:
            continue
        world = obj.matrix_world.copy()
        parent = obj.parent
        obj.parent = arm
        obj.parent_type = 'BONE'
        obj.parent_bone = parent.name
        obj.matrix_world = world
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
        for frame in range(info['frames'][1] + 1):
            scene.frame_set(frame)
            for obj in controls:
                bone = arm.pose.bones[obj.name]
                rest_local = bone_rest[obj]
                local = obj.matrix_parent_inverse @ obj.matrix_basis @ basis
                if obj.parent in controls:
                    rest_local = bone_rest[obj.parent].inverted() @ rest_local
                    local = basis.inverted() @ local
                # Work in local space: hidden parent magazines have singular
                # world matrices, but their round bones still need unit locals.
                bone.matrix_basis = rest_local.inverted() @ local
                q = bone.rotation_quaternion
                if obj.name in previous:
                    q.make_compatible(previous[obj.name])
                previous[obj.name] = q.copy()
                for path in ('location', 'rotation_quaternion', 'scale'):
                    bone.keyframe_insert(path, frame=frame, group=obj.name)
        # All scale channels remain discrete, including magazine/round handoffs.
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
        strip.action_frame_end = info['frames'][1]
        strip.extrapolation = 'HOLD'
        arm.animation_data.action = None
        track.mute = True
    arm.animation_data.use_nla = True
    # Object actions remain editable bake-source controls, but must not also be
    # exported as duplicate nodes alongside the animated bones of the same name.
    source = bpy.data.collections['P320 | high bake source (not exported)']
    for obj in controls:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        source.objects.link(obj)
    return arm
