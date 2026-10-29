"""Export-only rigid skin: share finishes across the four moving mechanisms.

Editable object actions stay authoritative. The insertion shell is deliberately
excluded: its independent parent owns exact fractional STEP visibility/reset.
"""
import bpy
from mathutils import Matrix, Vector


def build_mechanical_skin(collection, parts, clips):
    rig = parts[0].parent
    data = bpy.data.armatures.new('M590 mechanical bones')
    arm = bpy.data.objects.new('M590_SKIN', data)
    collection.objects.link(arm)
    arm.parent = rig
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
    surfaces = [obj for obj in collection.objects if obj.type == 'MESH' and obj.parent in parts]
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
    bpy.context.view_layer.objects.active = surfaces[0]
    bpy.ops.object.join()
    surface = bpy.context.object
    surface.name = 'M590_surface'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Joining by mechanism left duplicate slots for shared finishes.
    materials = list(surface.data.materials)
    unique = list(dict.fromkeys(materials))
    indices = [unique.index(materials[p.material_index]) for p in surface.data.polygons]
    surface.data.materials.clear()
    for material in unique:
        surface.data.materials.append(material)
    for polygon, index in zip(surface.data.polygons, indices):
        polygon.material_index = index
    modifier = surface.modifiers.new('Rigid mechanical skin', 'ARMATURE')
    modifier.object = arm
    arm.animation_data_create()
    for name, info in clips.items():
        action = bpy.data.actions.new(name + ' | mechanical skin')
        arm.animation_data.action = action
        slot = action.slots.new('OBJECT', arm.name)
        arm.animation_data.action_slot = slot
        layer = action.layers.new('Mechanical motion')
        bag = layer.strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
        for part in parts:
            bone = arm.pose.bones['MECH_' + part.name]
            bone.rotation_mode = 'QUATERNION'
            track = next(t for t in part.animation_data.nla_tracks if t.name == name)
            source_action = track.strips[0].action
            for source_layer in source_action.layers:
                for strip in source_layer.strips:
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
        strip.action_frame_end = info['duration'] * 120
        strip.frame_end = info['duration'] * 120
        track.mute = True
        arm.animation_data.action = None
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    return arm
