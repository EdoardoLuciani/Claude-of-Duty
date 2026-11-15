"""Original .338-class exterior, not a scaled SRD762Ti. Native metres."""
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import can

root, out = can.begin('SUPPRESSOR_338', 'assets/attachments/suppressor-338')
ceramic = can.material('338 | graphite ceramic', (.035, .039, .043), .65)
steel = can.material('338 | exposed mount steel', (.12, .13, .14), .38, 1)
mark = can.material('338 | engraving', (.40, .39, .35), .8)

# 280 x 50 mm .338 LM exterior: broad blast chamber, recessed 11 mm endcap,
# stepped rear sleeve receiving the weapon-owned 23 mm adapter. No physical
# baffle/rating claim; the open shadow chamber is deliberately inspectable.
can.lathe('338 rear mount sleeve', [(0, .014), (.003, .016), (.022, .016),
          (.022, .012), (0, .012)], steel, root)
profile = [(.018, .016), (.025, .023), (.029, .025), (.050, .025)]
for y in (.052, .086, .120, .154, .188, .222, .256):
    profile.extend([(y, .0247), (y+.001, .025), (y+.002, .0247)])
profile.extend([(.275, .0247), (.280, .0235), (.280, .0055),
                (.276, .0055), (.276, .022), (.030, .022), (.018, .012)])
can.lathe('338 pressure body and open endcap', profile, ceramic, root)
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

_, vertices = can.bore()
assert abs(max(p.y for p in vertices)-min(p.y for p in vertices)-.280) < 1e-6
assert abs(max(p.x for p in vertices)-.025) < .0002
# 10.6 mm clear gauge: .338 projectile (8.59 mm) plus >1 mm radial margin.
can.assert_clear('338', (0, .0025, .0045, .0053), .280, rays=48)
can.export(root, out, 'suppressor338', .280)
