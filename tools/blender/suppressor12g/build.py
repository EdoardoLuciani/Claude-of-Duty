"""Dedicated 12g expansion can, not a scaled rifle asset. Native metres."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import can

root, out = can.begin('SUPPRESSOR_12G', 'assets/attachments/12g-suppressor')
ceramic = can.material('12g | graphite ceramic', (.035, .039, .043), .72)
steel = can.material('12g | machined end rings', (.085, .093, .10), .48, 1)
mark = can.material('12g | engraved identification', (.36, .34, .29), .8)
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
bpy.context.collection.objects.link(body)
body.parent = root
mesh.materials.append(ceramic)
mesh.materials.append(steel)
for face, index in zip(mesh.polygons, materials):
    face.material_index = index
    face.use_smooth = len(face.vertices) == 4 and face.index < (len(stations)-1)*2*N
# Raised shallow identification follows the side tangent, not the bore/endcap.
can.text('12g identification', '12 GA / EXPANSION', (.0421, .080, -.004), .004, mark, root, .000015)

# 18.6 mm shot envelope at the seat, expanding at 7 degrees half-angle.
# Runtime's worst rest spread is 1.2*1.15*2.2*2 = 6.072 degrees;
# post-shot spreadMax is 2.1. This deliberately exceeds both, without tuning them.
tree, _ = can.assert_clear('12g', (0, .00465, .0093), .220, rays=96, half_angle=7)
assert tree.ray_cast(Vector((.039, .23, 0)), Vector((0, -1, 0)), .02)[0] is not None, 'real open annular endcap'
can.export(root, out, 'suppressor12g', .220)
