"""Export-only rigid mechanical skin; editable controls remain authoritative."""
import bpy
from mathutils import Matrix, Vector


def consolidate_mechanics(asset, clips):
    """Share opaque draws without coupling pouch STEP or ammunition ownership.

    Stock has its own rigid joint, not its own primitive: the clearance oracle
    selects actual stock triangles by that joint's one-influence membership.
    The existing deforming belt intentionally retains its independent skin.
    """
    rig = bpy.data.objects['EVOLYS_RIG']
    parts = [bpy.data.objects[name] for name in (
        'receiver', 'handguard', 'optic', 'stock', 'bolt',
        'charging_handle', 'feed_cover', 'trigger',
    )]
    data = bpy.data.armatures.new('EVOLYS mechanical bones')
    arm = bpy.data.objects.new('EVOLYS_mechanics', data)
    asset.objects.link(arm)
    arm.parent = rig
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    rest = {part: part.location.copy() for part in parts}
    for part in parts:
        assert part.parent == rig
        assert part.rotation_quaternion.angle < 1e-6
        bone = data.edit_bones.new('MECH_' + part.name)
        bone.head = rest[part]
        bone.tail = bone.head + Vector((0, .01, 0))
    bpy.ops.object.mode_set(mode='OBJECT')
    surfaces = [bpy.data.objects[part.name + '_mesh'] for part in parts]
    for obj in surfaces:
        # Freeze the native exporter's local-space tessellation before moving
        # surfaces into a common bind space (notably the rotated stock).
        # Preserve split normals rather than recomputing them on tiny bevels.
        source = obj.data
        source.calc_loop_triangles()
        triangles = list(source.loop_triangles)
        mesh = bpy.data.meshes.new(source.name + ' export triangles')
        mesh.from_pydata([vertex.co for vertex in source.vertices], [], [tuple(t.vertices) for t in triangles])
        for material in source.materials:
            mesh.materials.append(material)
        for polygon, triangle in zip(mesh.polygons, triangles):
            polygon.material_index = triangle.material_index
            polygon.use_smooth = source.polygons[triangle.polygon_index].use_smooth
        loops = [loop for triangle in triangles for loop in triangle.loops]
        for uv in source.uv_layers:
            layer = mesh.uv_layers.new(name=uv.name)
            for target, index in zip(layer.data, loops):
                target.uv = uv.data[index].uv
        normal_matrix = (arm.matrix_world.inverted() @ obj.matrix_world).to_3x3().inverted().transposed()
        normals = mesh.attributes.new('evolys_export_normal', 'FLOAT_VECTOR', 'CORNER')
        for target, index in zip(normals.data, loops):
            target.vector = (normal_matrix @ source.corner_normals[index].vector).normalized()
        obj.data = mesh
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
    surface.name = 'mechanical_surfaces'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    normals = surface.data.attributes['evolys_export_normal']
    surface.data.normals_split_custom_set([value.vector for value in normals.data])
    surface.data.attributes.remove(normals)
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
            if not part.animation_data:
                continue
            track = next(t for t in part.animation_data.nla_tracks if t.name == name)
            for source_layer in track.strips[0].action.layers:
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
