"""Original .338-class exterior, not a scaled SRD762Ti. Native metres.

Blender +Y bore becomes glTF -Z; Blender +Z up becomes glTF +Y.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=ROOT/'assets/attachments/suppressor-338')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
root = bpy.data.objects.new('SUPPRESSOR_338', None)
bpy.context.collection.objects.link(root)


def material(name, color, roughness, metal=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    return mat


ceramic = material('338 | graphite ceramic', (.035, .039, .043), .65)
steel = material('338 | exposed mount steel', (.12, .13, .14), .38, 1)
mark = material('338 | engraving', (.40, .39, .35), .8)


def lathe(name, section, mat):
    # Closed radial cross-section: real open bore, including rear sleeve and cap.
    count = 96
    vertices = [(math.cos(i*math.tau/count)*radius, y, math.sin(i*math.tau/count)*radius)
                for y, radius in section for i in range(count)]
    faces = [(j*count+i, j*count+(i+1)%count,
              ((j+1)%len(section))*count+(i+1)%count,
              ((j+1)%len(section))*count+i)
             for j in range(len(section)) for i in range(count)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], [tuple(reversed(face)) for face in faces])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    mesh.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = polygon.index//count not in (len(section)-1,)
    return obj


# 280 x 50 mm .338 LM exterior: broad blast chamber, recessed 11 mm endcap,
# stepped rear sleeve receiving the weapon-owned 23 mm adapter. No physical
# baffle/rating claim; the open shadow chamber is deliberately inspectable.
lathe('338 rear mount sleeve', [(0, .014), (.003, .016), (.022, .016),
      (.022, .012), (0, .012)], steel)
profile = [(.018, .016), (.025, .023), (.029, .025), (.050, .025)]
for y in (.052, .086, .120, .154, .188, .222, .256):
    profile.extend([(y, .0247), (y+.001, .025), (y+.002, .0247)])
profile.extend([(.275, .0247), (.280, .0235), (.280, .0055),
                (.276, .0055), (.276, .022), (.030, .022), (.018, .012)])
lathe('338 pressure body and open endcap', profile, ceramic)
# Six wrench pockets distinguish the rear collar without closing its bore.
for i in range(6):
    angle = i*math.tau/6
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(angle)*.016, .011, math.sin(angle)*.016))
    obj = bpy.context.object
    obj.name = '338 collar wrench land'
    obj.dimensions = (.002, .010, .008)
    obj.rotation_euler.y = -angle
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = root
    obj.data.materials.append(steel)
bpy.ops.object.text_add(location=(-.0251, .065, -.003))
obj = bpy.context.object
obj.name = '338 calibre engraving'
obj.data.body = '.338 LM  /  11 mm'
obj.data.size = .003
obj.data.extrude = 0
obj.rotation_euler = (math.pi/2, 0, math.pi/2)
bpy.ops.object.convert(target='MESH')
obj.parent = root
obj.data.materials.append(mark)
for name, loc in [('SOCKET_mount', (0, 0, 0)), ('SOCKET_muzzle', (0, .280, 0))]:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    obj.location = loc
bpy.ops.wm.save_as_mainfile(filepath=str(out/'suppressor338.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'suppressor338.glb'), export_format='GLB',
                          export_animations=False, export_extras=True, export_yup=True)
# Independently inspect the saved geometry and exported frame.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from check import check_suppressor
check_suppressor(out/'suppressor338.glb')
