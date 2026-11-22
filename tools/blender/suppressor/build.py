"""Standalone SRD762Ti exterior in the shared metric can frame."""
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import can

root, out = can.begin('SUPPRESSOR', '.cache/blender/attachments/sig-srd762ti')
ceramic = can.material('06 | suppressor graphite ceramic', (.045, .046, .049), .76)
rubber = can.material('05 | bore shadow', (.008, .009, .010), .95)
mark = can.material('09 | laser markings', (.60, .57, .47), .88)
SIDES = 64


def tube(name, rear, front, radius, inner, mat):
    return can.lathe(name, [(rear, radius), (front, radius), (front, inner), (rear, inner)],
                     mat, root, sides=SIDES, smooth=())


mount = tube('Suppressor mount', 0, .016, .013, .0095, ceramic)
for side in (-1, 1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(side*.015, .006, 0))
    cutter = bpy.context.object
    cutter.dimensions = (.008, .012, .030)
    mod = mount.modifiers.new('Wrench flat', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    with bpy.context.temp_override(object=mount):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

# The open outer skin meets the mount and endcap without an additional bore wall.
profile = [(.014, .013), (.016, .0205), (.020, .022), (.052, .022), (.054, .0215)]
for y in (.071, .095, .119, .143, .167, .191, .215):
    profile.extend([(y-.0005, .0215), (y, .02165), (y+.0005, .0215)])
profile.extend([(.230, .0215), (.234, .0208)])
vertices = [(math.cos(i*math.tau/SIDES)*r, y, math.sin(i*math.tau/SIDES)*r)
            for y, r in profile for i in range(SIDES)]
faces = [(j*SIDES+i, (j+1)*SIDES+i, (j+1)*SIDES+(i+1)%SIDES, j*SIDES+(i+1)%SIDES)
         for j in range(len(profile)-1) for i in range(SIDES)]
mesh = bpy.data.meshes.new('SRD762Ti exterior')
mesh.from_pydata(vertices, [], faces)
body = bpy.data.objects.new('Suppressor body', mesh)
bpy.context.collection.objects.link(body)
body.parent = root
mesh.materials.append(ceramic)
for polygon in mesh.polygons:
    polygon.use_smooth = True

# Universal 9mm-clear game-fit endcap; exterior only, not SRD762Ti certification.
tube('Recessed suppressor endcap', .232, .236, .0208, .0052, ceramic)
tube('Muzzle interior shadow', .2275, .2285, .0205, .0052, rubber)
can.text('Mark | SIG SAUER', 'SIG SAUER', (.0222, .028, .003), .0028, mark, root)
can.text('Mark | SRD762Ti', 'SRD762Ti', (.0222, .028, -.001), .0028, mark, root)

# 10.2mm clear gauge: a 9mm projectile plus at least .6mm radial margin.
can.assert_clear('SRD762Ti', (0, .0025, .0045, .0051), .236)
can.export(root, out, 'suppressor', .236)
