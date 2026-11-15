"""Original .338-class exterior, not a scaled SRD762Ti. Native metres."""
import sys
from pathlib import Path

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
can.ring('338 collar wrench land', 6, .016, .011, (.002, .010, .008), steel, root)
can.text('338 calibre engraving', '.338 LM  /  11 mm', (-.0251, .065, -.003), .003, mark, root)

# 10.6 mm clear gauge: .338 projectile (8.59 mm) plus >1 mm radial margin.
_, vertices = can.assert_clear('338', (0, .0025, .0045, .0053), .280, rays=48)
assert abs(max(p.x for p in vertices)-.025) < .0002
can.export(root, out, 'suppressor338', .280, batch=True)
