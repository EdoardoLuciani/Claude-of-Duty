"""Original compact 9mm pistol can with a visible booster, not a scaled rifle can."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import can

root, out = can.begin('SUPPRESSOR9MM', 'assets/attachments/compact-9mm')


def material(name, color, metal, rough):
    mat = can.material(name, color, rough, metal)
    # Fine coating roughness, not large invented damage or white edge paint.
    noise = mat.node_tree.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1900
    bump = mat.node_tree.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .14
    bump.inputs['Distance'].default_value = .00004
    mat.node_tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    mat.node_tree.links.new(bump.outputs['Normal'],
                            mat.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
    return mat


coat = material('Compact 9mm | graphite ceramic', (.032, .036, .041), .15, .61)
steel = material('Booster | nitrided piston', (.075, .081, .089), .8, .32)
edge = material('Booster | machined collars', (.12, .13, .14), .75, .4)


def tube(name, rear, front, radius, inner, mat):
    # Shade the outer and bore walls; the end faces stay flat.
    return can.lathe(name, [(rear, radius), (front, radius), (front, inner), (rear, inner)],
                     mat, root, sides=64, smooth=(0, 2))


# The stepped rear piston, exposed waist and fluted booster collar distinguish
# this moving-barrel mount from the long SRD762Ti direct-thread rifle exterior.
tube('Piston | rear seating sleeve', 0, .009, .0085, .00705, steel)
tube('Piston | exposed waist', .009, .018, .0078, .00705, steel)
tube('Booster | rear retaining ring', .008, .010, .010, .00705, edge)
tube('Booster | housing', .018, .033, .0115, .0052, coat)
can.ring('Booster | radial grip', 12, .0115, .0255, (.0015, .011, .0015), steel, root)
tube('Can | rear shoulder', .033, .037, .0132, .0052, edge)
tube('Can | compact body', .037, .130, .014, .0052, coat)
for y in (.041, .119, .127):
    tube('Can | circumferential seam', y, y+.0006, .0142, .01395, steel)
tube('Endcap | service ring', .130, .135, .0136, .0052, steel)
tube('Endcap | recessed bore', .133, .134, .007, .0052, coat)
# Real 10.4 mm opening: verify an unobstructed 10.2 mm gauge, including booster.
can.assert_clear('9mm', (0, .0025, .0051), .135)
can.export(root, out, 'suppressor9mm', .135)
