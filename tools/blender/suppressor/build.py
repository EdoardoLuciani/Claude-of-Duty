"""Standalone SRD762Ti exterior; no generated MCX input.

Native metres. Runtime mount is origin, bore forward -Z, up +Y.
"""
import json
import math
import struct
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from suppressor.geometry import build_suppressor

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT/'assets/attachments/sig-srd762ti'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
asset = bpy.context.collection


def material(name, color, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    return m


ceramic = material('06 | suppressor graphite ceramic', (.045, .046, .049), .76)
rubber = material('05 | bore shadow', (.008, .009, .010), .95)
mark = material('09 | laser markings', (.60, .57, .47), .88)


def active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def finish(o, name, mat, bevel=0):
    o.name = name
    o.data.materials.append(mat)
    active(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('Machined edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def cylinder(name, loc, radius, depth, mat, vertices=48, bevel=.00035):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    o = bpy.context.object
    o.rotation_euler.y = math.pi/2
    return finish(o, name, mat, bevel)


def opening(o, loc, dims, radius=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    cutter = bpy.context.object
    cutter.dimensions = dims
    active(cutter)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    active(o)
    mod = o.modifiers.new('Opening', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def tube(name, loc, radius, inner, length, mat):
    # Open annulus, including its real bore rather than a painted end disk.
    verts = [(loc[0]+x, math.cos(a)*r, math.sin(a)*r)
             for x, r in [(-length/2, radius), (length/2, radius),
                          (length/2, inner), (-length/2, inner)]
             for a in [i*math.tau/64 for i in range(64)]]
    faces = [(j*64+i, j*64+(i+1)%64, ((j+1)%4)*64+(i+1)%64, ((j+1)%4)*64+i)
             for j in range(4) for i in range(64)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    asset.objects.link(o)
    return finish(o, name, mat)


def text(label, loc, size):
    bpy.ops.object.text_add(location=loc)
    o = bpy.context.object
    o.data.body = label
    o.data.size = size
    o.data.extrude = .00002
    o.rotation_euler = (math.pi/2, 0, 0)
    active(o)
    bpy.ops.object.convert(target='MESH')
    return finish(o, 'Mark | '+label, mark)


build_suppressor(asset, cylinder, opening, finish, tube, text, ceramic, rubber)
# Original MCX +X-forward geometry: move its rear seating plane to zero,
# rotate to Blender +Y forward (glTF -Z), retaining physical dimensions.
transform = Matrix(((0, -1, 0, 0), (1, 0, 0, -.274), (0, 0, 1, 0), (0, 0, 0, 1)))
for o in list(asset.objects):
    o.matrix_world = transform @ o.matrix_world

root = bpy.data.objects.new('SUPPRESSOR', None)
asset.objects.link(root)
for name, loc in [('SOCKET_mount', (0, 0, 0)), ('SOCKET_muzzle', (0, .236, 0))]:
    o = bpy.data.objects.new(name, None)
    asset.objects.link(o)
    o.parent = root
    o.location = loc
# Mesh ends at x=.510 (recessed endcap); exit sits at that forward face.
objects = [o for o in asset.objects if o.type == 'MESH']
active(objects[0])
for o in objects:
    o.select_set(True)
bpy.ops.object.join()
o = bpy.context.object
o.name = 'suppressor_mesh'
o.parent = root
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'suppressor.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'suppressor.glb'), export_format='GLB',
                          export_animations=False, export_extras=True, export_yup=True)
# Guard the exported frame, not only the Blender scene: Blender +Y becomes glTF -Z.
raw = (OUT/'suppressor.glb').read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
nodes = json.loads(raw[20:20+length])['nodes']
exit = next(n for n in nodes if n.get('name') == 'SOCKET_muzzle')['translation']
assert (Vector(exit)-Vector((0, 0, -.236))).length < 1e-6, 'suppressor exit must face forward in glTF'
