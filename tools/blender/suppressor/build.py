"""Standalone SRD762Ti exterior. Native metres; authored on +X, then turned to the
shared can frame (runtime mount at origin, bore forward -Z, up +Y)."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import can

root, out = can.begin('SUPPRESSOR', 'assets/attachments/sig-srd762ti')
asset = bpy.context.collection
ceramic = can.material('06 | suppressor graphite ceramic', (.045, .046, .049), .76)
rubber = can.material('05 | bore shadow', (.008, .009, .010), .95)
mark = can.material('09 | laser markings', (.60, .57, .47), .88)


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


def opening(o, loc, dims):
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


# SRD762Ti direct-thread exterior: 236 mm overall / 44 mm diameter.
# Subtle circumferential seams, no invented cooling flutes or QD locking rings.
mount = tube('Suppressor mount', (.282, 0, 0), .013, .0095, .016, ceramic)
for side in (-1, 1):
    opening(mount, (.280, side*.015, 0), (.012, .008, .030))
profile_rings = [(.288, .013), (.290, .0205), (.294, .022), (.326, .022), (.328, .0215)]
for x in (.345, .369, .393, .417, .441, .465, .489):
    profile_rings.extend([(x-.0005, .0215), (x, .02165), (x+.0005, .0215)])
profile_rings.extend([(.504, .0215), (.508, .0208)])
verts = [(x, math.cos(i*math.tau/64)*r, math.sin(i*math.tau/64)*r)
         for x, r in profile_rings for i in range(64)]
faces = [(j*64+i, j*64+(i+1)%64, (j+1)*64+(i+1)%64, (j+1)*64+i)
         for j in range(len(profile_rings)-1) for i in range(64)]
mesh = bpy.data.meshes.new('SRD762Ti exterior')
mesh.from_pydata(verts, [], faces)
mesh.update()
body = bpy.data.objects.new('Suppressor body', mesh)
asset.objects.link(body)
for polygon in mesh.polygons:
    polygon.use_smooth = True
finish(body, body.name, ceramic)
# Universal 9mm-clear game-fit endcap; exterior only, not SRD762Ti certification.
tube('Recessed suppressor endcap', (.508, 0, 0), .0208, .0052, .004, ceramic)
tube('Muzzle interior shadow', (.502, 0, 0), .0205, .0052, .001, rubber)
text('SIG SAUER', (.302, -.0222, .003), .0028)
text('SRD762Ti', (.302, -.0222, -.001), .0028)

# Original MCX +X-forward geometry: move its rear seating plane to zero,
# rotate to Blender +Y forward (glTF -Z), retaining physical dimensions.
transform = Matrix(((0, -1, 0, 0), (1, 0, 0, -.274), (0, 0, 1, 0), (0, 0, 0, 1)))
meshes = [o for o in asset.objects if o.type == 'MESH']
for o in meshes:
    o.matrix_world = transform @ o.matrix_world
active(meshes[0])
for o in meshes:
    o.select_set(True)
bpy.ops.object.join()
o = bpy.context.object
o.name = 'suppressor_mesh'
o.parent = root
# 10.2mm clear gauge: a 9mm projectile plus at least .6mm radial margin.
can.assert_clear('SRD762Ti', (0, .0025, .0045, .0051), .236)
can.export(root, out, 'suppressor', .236)
