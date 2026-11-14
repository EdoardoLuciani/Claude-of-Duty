"""Build standalone ACOG from source, never a generated weapon blend/GLB."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[3]
ID = 'acog'
OUT = ROOT / 'assets/attachments/trijicon-acog'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'textures').mkdir(exist_ok=True)
sys.path.insert(0, str(ROOT / 'tools/blender'))
from acog.geometry import build_acog
from mcx.materials import build_materials
from mcx.export import prepare_surfaces
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
asset = bpy.data.collections.new('ACOG | authored components')
scene.collection.children.link(asset)
rig = bpy.data.objects.new('ACOG_source', None)
asset.objects.link(rig)
build_acog(asset, rig, build_materials(OUT))
prepare_surfaces(asset)
objects = [o for o in asset.objects if o.type in ('MESH', 'FONT')]
# Convert MCX's +X-forward Blender frame to the same -Z-forward game frame as
# the other weapons. The standalone rail-contact datum becomes identity.
mount = Vector((-.081, 0, .046))
rotation = Matrix.Rotation(math.pi / 2, 4, 'Z')
transform = rotation @ Matrix.Translation(-mount) @ rig.matrix_world.inverted()
sight = transform @ Vector((-.149, 0, .087))
# Evaluate modifiers before discarding construction helpers; keep the original packed
# surface maps and UVs, with no animation, skin or weapon-only resource retained.
depsgraph = bpy.context.evaluated_depsgraph_get()
root = bpy.data.objects.new(ID.upper(), None)
scene.collection.objects.link(root)
meshes = []
for source in objects:
    data = bpy.data.meshes.new_from_object(source.evaluated_get(depsgraph))
    data.transform(transform @ source.matrix_world)
    obj = bpy.data.objects.new(source.name + ' | attachment', data)
    scene.collection.objects.link(obj)
    obj.parent = root
    meshes.append(obj)
for obj in list(scene.objects):
    if obj != root and obj not in meshes:
        bpy.data.objects.remove(obj, do_unlink=True)
for name, position in [('MOUNT_base', Vector((0, 0, 0))),
                       ('SOCKET_sight', sight)]:
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.parent = root
    obj.location = position
# Thin coated glass is an explicit readability exception, not transmission.
for obj in meshes:
    for material in obj.data.materials:
        if material and material.name.startswith('11 |'):
            shader = material.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Transmission Weight'].default_value = 0
            shader.inputs['Alpha'].default_value = .1
            material.surface_render_method = 'DITHERED'
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / (ID + '.blend')), compress=True)
# Batch the rigid runtime assembly by finish; source stays independently editable.
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
bpy.context.object.name = ID + '_mesh'
bpy.ops.export_scene.gltf(filepath=str(OUT / (ID + '.glb')), export_format='GLB',
                          export_animations=False, export_extras=True, export_yup=True,
                          export_cameras=False, export_lights=False)
