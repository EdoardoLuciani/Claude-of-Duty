"""Dedicated 12g expansion can, not a scaled rifle asset. Native metres.

Blender +Y forward / +Z up exports glTF -Z forward / +Y up.
"""
import argparse
import json
import math
import struct
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check import check_source

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=ROOT/'assets/attachments/12g-suppressor')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
args.output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
root = bpy.data.objects.new('SUPPRESSOR_12G', None)
scene.collection.objects.link(root)


def material(name, color, roughness, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    return mat


ceramic = material('12g | graphite ceramic', (.035, .039, .043), .72)
steel = material('12g | machined end rings', (.085, .093, .10), .48, 1)
mark = material('12g | engraved identification', (.36, .34, .29), .8)
# Each station is (forward distance, outer radius, clear inner radius).
# A widening, genuinely open bore clears a conservative 7 degree shot envelope.
# The neck seats on the existing adapter face without reaching behind it.
stations = [(0, .0145, .0096), (.004, .017, .0101),
            (.030, .042, .014), (.034, .042, .0145),
            (.035, .041, .0147), (.039, .041, .0153),
            (.040, .042, .0154), (.202, .042, .036),
            (.203, .041, .0361), (.208, .041, .0368),
            (.209, .042, .037), (.216, .042, .038),
            (.220, .040, .038)]
N = 96
vertices = [(r*math.cos(i*math.tau/N), y, r*math.sin(i*math.tau/N))
            for y, outer, inner in stations for r in (outer, inner) for i in range(N)]
faces = []
materials = []
for j in range(len(stations)-1):
    for side in range(2):
        for i in range(N):
            a = (j*2+side)*N+i
            b = (j*2+side)*N+(i+1)%N
            faces.append((a, b, b+2*N, a+2*N) if side == 0 else (b, a, a+2*N, b+2*N))
            materials.append(1 if j in (0, 10, 11) else 0)
for j in (0, len(stations)-1):
    for i in range(N):
        a = j*2*N+i
        b = j*2*N+(i+1)%N
        faces.append((b, a, a+N, b+N) if j == 0 else (a, b, b+N, a+N))
        materials.append(1)
mesh = bpy.data.meshes.new('12g expansion shell with open flared bore')
mesh.from_pydata(vertices, [], [tuple(reversed(face)) for face in faces])
mesh.update()
body = bpy.data.objects.new('suppressor12g_mesh', mesh)
scene.collection.objects.link(body)
body.parent = root
mesh.materials.append(ceramic)
mesh.materials.append(steel)
for face, index in zip(mesh.polygons, materials):
    face.material_index = index
    face.use_smooth = len(face.vertices) == 4 and face.index < (len(stations)-1)*2*N
# Raised shallow identification follows the side tangent, not the bore/endcap.
bpy.ops.object.text_add(location=(.0421, .080, -.004))
label = bpy.context.object
label.name = '12g identification'
label.data.body = '12 GA / EXPANSION'
label.data.size = .004
label.data.extrude = .000015
label.rotation_euler = (math.pi/2, 0, math.pi/2)
label.data.materials.append(mark)
bpy.ops.object.convert(target='MESH')
label.parent = root
for name, y in (('SOCKET_mount', 0), ('SOCKET_muzzle', .220)):
    node = bpy.data.objects.new(name, None)
    scene.collection.objects.link(node)
    node.parent = root
    node.location = (0, y, 0)
bpy.context.view_layer.update()
check_source()
bpy.ops.wm.save_as_mainfile(filepath=str(args.output/'suppressor12g.blend'))
bpy.ops.export_scene.gltf(filepath=str(args.output/'suppressor12g.glb'), export_format='GLB',
                          export_animations=False, export_extras=True, export_yup=True)
raw = (args.output/'suppressor12g.glb').read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
nodes = json.loads(raw[20:20+length])['nodes']
exit = next(n for n in nodes if n.get('name') == 'SOCKET_muzzle')['translation']
assert sum((a-b)**2 for a, b in zip(exit, (0, 0, -.220))) < 1e-14, 'exported exit frame'
