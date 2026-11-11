"""Extract shared optics from freshly generated, editable weapon Blender sources.

Run after the MCX/AX338 build: blender -b --python tools/blender/optics.py -- acog|scope
No old GLB or hand-edited .blend is an authoring input. build-assets.ts builds the
canonical Python sources first and hashes their saved Blender product here.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
ID = sys.argv[sys.argv.index('--') + 1]
assert ID in ('acog', 'scope')
ACOG = ID == 'acog'
SOURCE = ROOT / ('assets/weapons/mcx-virtus/mcx-virtus.blend' if ACOG else 'assets/weapons/ax338/ax338.blend')
OUT = ROOT / ('assets/attachments/trijicon-acog' if ACOG else 'assets/attachments/schmidt-bender-pm-ii')
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
scene.frame_set(0)
bpy.context.view_layer.update()
rig = bpy.data.objects['MCX_RIG' if ACOG else 'AX338_RIG']
objects = [o for o in scene.objects if o.type in ('MESH', 'FONT') and
           (o.get('sharedOptic') == 'acog' if ACOG else o.parent == bpy.data.objects['optic'])]
assert objects, 'Missing authored optic assembly; rebuild the source weapon'
# Convert MCX's +X-forward Blender frame to the same -Z-forward game frame as
# the M4/AX338. Both standalone rail-contact datums become the identity origin.
mount = Vector((-.081, 0, .046)) if ACOG else Vector((0, .089, .1205))
sight = Vector((-.149, 0, .087)) if ACOG else Vector((0, -.087, .159))
rotation = Matrix.Rotation(math.pi / 2, 4, 'Z') if ACOG else Matrix.Identity(4)
transform = rotation @ Matrix.Translation(-mount) @ rig.matrix_world.inverted()
# Evaluate modifiers before discarding the weapon; keep its original packed
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
                       ('SOCKET_sight', rotation.to_3x3() @ (sight - mount))]:
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.parent = root
    obj.location = position
# Thin coated glass is an explicit readability exception, not transmission.
for obj in meshes:
    for material in obj.data.materials:
        if material and material.name.startswith('11 |' if ACOG else '10 |'):
            shader = material.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Transmission Weight'].default_value = 0
            shader.inputs['Alpha'].default_value = .1 if ACOG else .13
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
