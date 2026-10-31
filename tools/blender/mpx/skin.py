"""Export-only skin with original mesh-local coordinates and posed rigid frames."""
import bpy
import numpy as np
from mathutils import Matrix

PARTS = ('receiver', 'bolt', 'charging_handle', 'selector', 'trigger',
         'stock_hinge', 'bolt_release', 'magazine_catch',
         'lens_cap_front', 'lens_cap_rear')


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def preserve_normal_encoding(mesh):
    # Join decodes/re-encodes custom normals even for an identity transform.
    # That round trip is lossy on degenerate bevel fans. Keep Blender's native
    # short2 encoding, with unchanged local geometry/sharpness/fan topology.
    encoded = np.empty(len(mesh.loops) * 2, dtype=np.int32)
    mesh.attributes['custom_normal'].data.foreach_get('value', encoded)
    saved = mesh.attributes.new('mpx_normal_encoding', 'INT32_2D', 'CORNER')
    saved.data.foreach_set('value', encoded)
    values = np.empty(len(mesh.loops) * 3, dtype=np.float32)
    mesh.corner_normals.foreach_get('vector', values)
    mesh.attributes.new('mpx_normal_reference', 'FLOAT_VECTOR', 'CORNER').data.foreach_set('vector', values)


def restore_normal_encoding(mesh):
    encoded = np.empty(len(mesh.loops) * 2, dtype=np.int32)
    mesh.attributes['mpx_normal_encoding'].data.foreach_get('value', encoded)
    mesh.attributes['custom_normal'].data.foreach_set('value', encoded)
    mesh.update()
    reference = np.empty(len(mesh.loops) * 3, dtype=np.float32)
    actual = np.empty_like(reference)
    mesh.attributes['mpx_normal_reference'].data.foreach_get('vector', reference)
    mesh.corner_normals.foreach_get('vector', actual)
    assert np.max(np.abs(reference - actual)) < 1e-6, (mesh.name, 'local corner normal changed')
    mesh.attributes.remove(mesh.attributes['mpx_normal_encoding'])
    mesh.attributes.remove(mesh.attributes['mpx_normal_reference'])


def consolidate_mechanics(collection, clips):
    """Identity binds preserve local bevel geometry; pose frames assemble it.

    Rebasing float32 bevel vertices before export changes nonzero tiny faces and
    Blender's corner-normal fan reconstruction. Do not apply object transforms
    or re-encode decoded normals here. Control and mesh frames remain distinct so
    interpolated rotation still rotates the original local mesh offset exactly.
    Stock export must use export_rest_position_armature=False.
    """
    controls = [bpy.data.objects[name] for name in PARTS]
    frames = {}
    surfaces = []
    for obj in list(collection.objects):
        if obj.type != 'MESH' or obj.parent not in controls:
            continue
        parent = obj.parent
        frames[parent] = obj.matrix_local.copy()
        preserve_normal_encoding(obj.data)
        active(obj)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='MATERIAL')
        bpy.ops.object.mode_set(mode='OBJECT')
        for piece in list(bpy.context.selected_objects):
            material = piece.data.materials[piece.data.polygons[0].material_index]
            if material.name != 'MPX | consolidated opaque finishes':
                piece.name = parent.name + ('_interior' if material.name.startswith('15 |') else '_optical')
                restore_normal_encoding(piece.data)
                continue
            group = piece.vertex_groups.new(name='FRAME_' + parent.name)
            group.add(list(range(len(piece.data.vertices))), 1, 'REPLACE')
            piece.parent = None
            piece.matrix_world = Matrix.Identity(4)
            surfaces.append(piece)

    data = bpy.data.armatures.new('MPX mechanical frames')
    arm = bpy.data.objects.new('MPX_mechanics', data)
    collection.objects.link(arm)
    arm.parent = bpy.data.objects['MPX_RIG']
    active(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    for obj in controls:
        bone = data.edit_bones.new('MECH_' + obj.name)
        bone.head = (0, 0, 0)
        bone.tail = (0, .01, 0)
        frame = data.edit_bones.new('FRAME_' + obj.name)
        frame.head = (0, 0, 0)
        frame.tail = (0, .01, 0)
        frame.parent = bone
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in controls:
        control = arm.pose.bones['MECH_' + obj.name]
        control.rotation_mode = 'QUATERNION'
        control.matrix_basis = obj.matrix_local
        frame = arm.pose.bones['FRAME_' + obj.name]
        frame.rotation_mode = 'QUATERNION'
        frame.matrix_basis = frames[obj]

    active(surfaces[0])
    for obj in surfaces:
        obj.select_set(True)
    bpy.ops.object.join()
    surface = bpy.context.object
    surface.name = 'MPX_surface'
    restore_normal_encoding(surface.data)
    surface.parent = arm
    surface.data.materials.clear()
    surface.data.materials.append(bpy.data.materials['MPX | consolidated opaque finishes'])
    for face in surface.data.polygons:
        face.material_index = 0
    surface.modifiers.new('Rigid mechanical skin', 'ARMATURE').object = arm

    arm.animation_data_create()
    for name, info in clips.items():
        action = bpy.data.actions.new(name + ' | mechanical skin')
        arm.animation_data.action = action
        slot = action.slots.new('OBJECT', arm.name)
        arm.animation_data.action_slot = slot
        bag = action.layers.new('Mechanics').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
        for obj in controls:
            if not obj.animation_data:
                continue
            track = next(t for t in obj.animation_data.nla_tracks if t.name == name)
            source = track.strips[0].action
            bone = arm.pose.bones['MECH_' + obj.name]
            for layer in source.layers:
                for strip in layer.strips:
                    for source_bag in strip.channelbags:
                        for curve in source_bag.fcurves:
                            target = bag.fcurves.new(bone.path_from_id(curve.data_path), index=curve.array_index)
                            target.keyframe_points.add(len(curve.keyframe_points))
                            for old, new in zip(curve.keyframe_points, target.keyframe_points):
                                new.co = old.co
                                new.interpolation = old.interpolation
                            target.update()
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, action)
        strip.action_frame_start = 0
        strip.action_frame_end = info['frames'][1]
        strip.frame_end = info['frames'][1]
        strip.extrapolation = 'HOLD'
        track.mute = True
        arm.animation_data.action = None
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    return arm
