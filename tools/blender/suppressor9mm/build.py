"""Original compact 9mm pistol can with a visible booster, not a scaled rifle can.
Native metres, +Y forward / +Z up; glTF -Z forward / +Y up.
"""
import json
import math
import struct
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'assets/attachments/compact-9mm'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
root = bpy.data.objects.new('SUPPRESSOR9MM', None)
bpy.context.collection.objects.link(root)


def material(name, color, metal, rough):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    # Fine coating roughness, not large invented damage or white edge paint.
    noise = mat.node_tree.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1900
    bump = mat.node_tree.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .14
    bump.inputs['Distance'].default_value = .00004
    mat.node_tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    mat.node_tree.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    return mat


coat = material('Compact 9mm | graphite ceramic', (.032, .036, .041), .15, .61)
steel = material('Booster | nitrided piston', (.075, .081, .089), .8, .32)
edge = material('Booster | machined collars', (.12, .13, .14), .75, .4)


def tube(name, rear, front, radius, inner, mat, sides=64):
    vertices = [(math.cos(a) * r, y, math.sin(a) * r)
                for y, r in [(rear, radius), (front, radius), (front, inner), (rear, inner)]
                for a in [i * math.tau / sides for i in range(sides)]]
    faces = [(j*sides+i, j*sides+(i+1)%sides,
              ((j+1)%4)*sides+(i+1)%sides, ((j+1)%4)*sides+i)
             for j in range(4) for i in range(sides)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], [tuple(reversed(face)) for face in faces])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    obj.data.materials.append(mat)
    for face in mesh.polygons:
        face.use_smooth = face.index < sides or 2*sides <= face.index < 3*sides
    return obj


# The stepped rear piston, exposed waist and fluted booster collar distinguish
# this moving-barrel mount from the long SRD762Ti direct-thread rifle exterior.
tube('Piston | rear seating sleeve', 0, .009, .0085, .00705, steel)
tube('Piston | exposed waist', .009, .018, .0078, .00705, steel)
tube('Booster | rear retaining ring', .008, .010, .010, .00705, edge)
tube('Booster | housing', .018, .033, .0115, .0052, coat)
for i in range(12):
    angle = i * math.tau / 12
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(angle)*.0115, .0255, math.sin(angle)*.0115))
    obj = bpy.context.object
    obj.name = 'Booster | radial grip %02d' % i
    obj.dimensions = (.0015, .011, .0015)
    obj.rotation_euler.y = -angle
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = root
    obj.data.materials.append(steel)
tube('Can | rear shoulder', .033, .037, .0132, .0052, edge)
tube('Can | compact body', .037, .130, .014, .0052, coat)
for y in (.041, .119, .127):
    tube('Can | circumferential seam', y, y+.0006, .0142, .01395, steel)
tube('Endcap | service ring', .130, .135, .0136, .0052, steel)
tube('Endcap | recessed bore', .133, .134, .007, .0052, coat)
for name, position in [('SOCKET_mount', (0, 0, 0)), ('SOCKET_muzzle', (0, .135, 0))]:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    obj.location = position
bpy.context.view_layer.update()
# Real 10.4 mm opening: verify an unobstructed 10.2 mm gauge, including booster.
vertices, faces = [], []
for obj in root.children:
    if obj.type != 'MESH':
        continue
    start = len(vertices)
    vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
    faces.extend(tuple(start+i for i in p.vertices) for p in obj.data.polygons)
bore = BVHTree.FromPolygons(vertices, faces)
for radius in (0, .0025, .0051):
    for i in range(32):
        origin = Vector((radius*math.cos(i*math.tau/32), -.001, radius*math.sin(i*math.tau/32)))
        assert bore.ray_cast(origin, Vector((0, 1, 0)), .137)[0] is None, '9mm bore obstructed'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'suppressor9mm.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT / 'suppressor9mm.glb'), export_format='GLB',
                          export_animations=False, export_extras=True, export_yup=True)
raw = (OUT / 'suppressor9mm.glb').read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
nodes = json.loads(raw[20:20+length])['nodes']
exit = next(n for n in nodes if n.get('name') == 'SOCKET_muzzle')['translation']
assert (Vector(exit)-Vector((0, 0, -.135))).length < 1e-6
print('SUPPRESSOR9MM_OK: 135mm compact booster can, 28.4mm maximum diameter, 10.2mm clear gauge, glTF -Z exit')
