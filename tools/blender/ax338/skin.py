"""Export-only rigid mechanics; original controls and source meshes stay editable."""
import bpy
from mathutils import Matrix, Vector


def consolidate_mechanics(asset, parts, clips):
    """Share one opaque draw, retaining one-influence ownership for geometry checks.

    Independent magazine bodies/rounds are not skinned. Glass retains its
    transparent material/primitive on the static optic bone.
    The six named helpers remain authoritative; only bolt/trigger have Actions.
    """
    data = bpy.data.armatures.new('AX338 mechanical bones')
    arm = bpy.data.objects.new('AX338_SKIN', data)
    asset.objects.link(arm)
    arm.parent = parts[0].parent
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    rest = {part: part.location.copy() for part in parts}
    for part in parts:
        bone = data.edit_bones.new('MECH_' + part.name)
        bone.head = rest[part]
        bone.tail = bone.head + Vector((0, .01, 0))
    bpy.ops.object.mode_set(mode='OBJECT')
    for bone in arm.pose.bones:
        bone.rotation_mode = 'QUATERNION'

    surfaces = [obj for obj in asset.objects if obj.type == 'MESH' and obj.parent in parts]
    for obj in surfaces:
        group = obj.vertex_groups.new(name='MECH_' + obj.parent.name)
        group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
        world = obj.matrix_world.copy()
        obj.parent = arm
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = world
    bpy.ops.object.select_all(action='DESELECT')
    for obj in surfaces:
        obj.select_set(True)
    # The handguard already has identity local axes and origin, avoiding an
    # unnecessary rotated active-object frame while joining the other groups.
    bpy.context.view_layer.objects.active = next(obj for obj in surfaces if obj.name == 'handguard_mesh')
    bpy.ops.object.join()
    surface = bpy.context.object
    surface.name = 'AX338_surface'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    assert len(surface.data.materials) == 2, list(surface.data.materials)
    modifier = surface.modifiers.new('Rigid mechanical skin', 'ARMATURE')
    modifier.object = arm

    arm.animation_data_create()
    for name, info in clips.items():
        action = bpy.data.actions.new(name + ' | mechanical skin')
        arm.animation_data.action = action
        slot = action.slots.new('OBJECT', arm.name)
        arm.animation_data.action_slot = slot
        bag = action.layers.new('Mechanical motion').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
        for part in parts:
            if not part.animation_data:
                continue
            bone = arm.pose.bones['MECH_' + part.name]
            source = next(t for t in part.animation_data.nla_tracks if t.name == name).strips[0].action
            for layer in source.layers:
                for strip in layer.strips:
                    for source_bag in strip.channelbags:
                        for curve in source_bag.fcurves:
                            target = bag.fcurves.new(bone.path_from_id(curve.data_path), index=curve.array_index)
                            target.keyframe_points.add(len(curve.keyframe_points))
                            offset = rest[part][curve.array_index] if curve.data_path == 'location' else 0
                            for old, new in zip(curve.keyframe_points, target.keyframe_points):
                                new.co = (old.co.x, old.co.y - offset)
                                new.interpolation = old.interpolation
                            target.update()
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, action)
        strip.action_frame_start = 0
        strip.action_frame_end = info['frames'][1]
        strip.frame_end = info['frames'][1]
        track.mute = True
        arm.animation_data.action = None
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
