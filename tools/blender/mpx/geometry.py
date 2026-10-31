"""Export-only rigid surfaces with original local geometry and packed normals."""
import bpy
import numpy as np


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


def separate_receiver_finishes(collection):
    """Ordinary rigid owners retain their original local geometry and transforms.

    Only the receiver needs independent optical/interior sorting objects. Preserve
    packed normal fans through Blender's material separation, without rebasing.
    """
    receiver = next(obj for obj in collection.objects if obj.name == 'receiver_mesh')
    preserve_normal_encoding(receiver.data)
    active(receiver)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    for piece in list(bpy.context.selected_objects):
        material = piece.data.materials[piece.data.polygons[0].material_index]
        if material.name.startswith('15 |'):
            piece.name = 'receiver_interior'
        elif material.name.startswith('11 |'):
            piece.name = 'receiver_optical'
        else:
            piece.name = 'receiver_mesh'
        restore_normal_encoding(piece.data)
