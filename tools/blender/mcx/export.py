"""Deterministic surface coordinates and one unmodified Blender glTF export."""
import bpy

# One repeat per 10 cm, independent of component bounds or packing order.
SURFACE_TILE_METRES = 0.10


def surface_uvs(obj):
    """Project each face onto its dominant world-space plane in the rest pose.

    These are repeating surface-detail maps, not a unique painted atlas. There
    are no islands to pack. The same rule is applied to the editable source and
    to final evaluated faces, so modifier interpolation cannot perturb export UVs.
    """
    mesh = obj.data
    for layer in list(mesh.uv_layers):
        mesh.uv_layers.remove(layer)
    uv = mesh.uv_layers.new(name='SurfaceUV')
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    for face in mesh.polygons:
        normal = normal_matrix @ face.normal
        axis = max(range(3), key=lambda index: abs(normal[index]))
        u, v = ((1, 2), (2, 0), (0, 1))[axis]
        sign = -1 if normal[axis] < 0 else 1
        for loop_index in face.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            position = obj.matrix_world @ vertex.co
            uv.data[loop_index].uv = (
                sign * position[u] / SURFACE_TILE_METRES,
                position[v] / SURFACE_TILE_METRES,
            )


def prepare_surfaces(asset):
    bpy.context.view_layer.update()
    for obj in asset.objects:
        if obj.type == 'MESH':
            surface_uvs(obj)


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def export_asset(asset, parts, output):
    """Consume the in-memory export copy; the source must already be saved.

    Parts must be in their rest pose, with all NLA tracks muted. Actions mode
    reads the authored curves, not a blended/evaluated NLA scene snapshot.
    """
    for obj in sorted(asset.objects, key=lambda item: item.name):
        if obj.type not in {'MESH', 'FONT'}:
            continue
        activate(obj)
        bpy.ops.object.convert(target='MESH')
        triangulate = obj.modifiers.new('Runtime triangles', 'TRIANGULATE')
        triangulate.quad_method = 'FIXED'
        triangulate.ngon_method = 'CLIP'
        bpy.ops.object.modifier_apply(modifier=triangulate.name)
        surface_uvs(obj)

    # One mesh per rigid parent. Explicit ordering fixes the active join object.
    for parent in [bpy.data.objects['receiver'], *parts[1:]]:
        meshes = sorted(
            (obj for obj in asset.objects if obj.type == 'MESH' and obj.parent == parent),
            key=lambda item: item.name,
        )
        if not meshes:
            continue
        activate(meshes[0])
        for obj in meshes:
            obj.select_set(True)
        bpy.ops.object.join()
        bpy.context.object.name = parent.name + '_mesh'

    bpy.ops.object.select_all(action='DESELECT')
    for obj in asset.objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(output / 'mcx-virtus.glb'),
        export_format='GLB',
        use_selection=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_merge_animation='NLA_TRACK',
        export_force_sampling=False,
        export_frame_range=False,
        export_optimize_animation_keep_anim_object=True,
        export_extras=True,
        export_yup=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
    )

    stats = {'triangles': 0, 'vertices': 0, 'meshes': 0, 'material_slots': 0}
    for obj in asset.objects:
        if obj.type == 'MESH':
            obj.data.calc_loop_triangles()
            stats['triangles'] += len(obj.data.loop_triangles)
            stats['vertices'] += len(obj.data.vertices)
            stats['meshes'] += 1
            stats['material_slots'] += len(obj.data.materials)
    return stats
