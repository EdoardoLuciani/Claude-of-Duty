"""Independent saved-source checks for the static MPX candidate, not visual sign-off.
blender -b assets/weapons/sig-mpx/mpx.blend --python-exit-code 1 --python tools/blender/mpx_check.py
"""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

scene = bpy.context.scene
assert scene.unit_settings.system == 'METRIC'
assert scene.render.engine == 'BLENDER_EEVEE'
assert not scene.eevee.use_raytracing
assert bpy.data.objects.get('MPX_RIG')
assert len(bpy.data.images) >= 3
for name in ['mpx-surface', 'mpx-orm', 'mpx-normal']:
    image = bpy.data.images[name]
    assert tuple(image.size) == (1024, 1024), name
    assert image.packed_file, name
assert not any(o.animation_data and (o.animation_data.action or o.animation_data.nla_tracks)
               for o in scene.objects), 'do not advertise static candidate as animated'

deps = bpy.context.evaluated_depsgraph_get()

def tree(name):
    o = bpy.data.objects[name].evaluated_get(deps)
    mesh = o.to_mesh()
    vertices = [o.matrix_world @ v.co for v in mesh.vertices]
    faces = [tuple(p.vertices) for p in mesh.polygons]
    bvh = BVHTree.FromPolygons(vertices, faces, all_triangles=False)
    o.to_mesh_clear()
    return bvh


def point(name):
    return bpy.data.objects['SOCKET_'+name].matrix_world.translation


# Blender mesh/transforms are float32; 1 micrometre is below the photo evidence
# resolution without mistaking a 1e-8 metre rounding difference for bad geometry.
EPS = 1e-6
assert abs(point('barrel_crown').x-point('breech').x-.2032) < EPS
barrel = bpy.data.objects['External barrel'].evaluated_get(deps)
assert abs(barrel.dimensions.x-.2032) < EPS, 'actual barrel mesh, not manifest alone'
can = bpy.data.objects['SRD9 MPX titanium exterior'].evaluated_get(deps)
assert abs(can.dimensions.x-.175) < EPS
assert abs(can.dimensions.y-.035) < EPS
assert abs(point('sight').z-(.044+.035814)) < EPS
assert point('ejection').y < -.02
# Through-side slots must not be black painted rectangles.
hg = tree('Hollow five-slot M-LOK handguard')
for x in (.119,.148,.190,.232,.274):
    assert hg.ray_cast(Vector((x,-.06,-.001)),Vector((0,1,0)),.12)[0] is None, (x,'closed M-LOK slot')
# Solid lands between slots still exist; test at a web with two distinct walls.
assert hg.ray_cast(Vector((.129,-.06,-.001)),Vector((0,1,0)),.12)[0] is not None
# Regression: the previous full-ellipse upper left a visible flank seam gap.
upper = tree('MPX continuous rounded upper')
lower = tree('Lower receiver shoulder')
for x in (-.075,-.05,-.02,.01):
    for y in (-.018,.018):
        u = upper.ray_cast(Vector((x,y,-.10)),Vector((0,0,1)),.20)[0]
        l = lower.ray_cast(Vector((x,y,.04)),Vector((0,0,-1)),.20)[0]
        assert u and l, (x,y,'missing mating surface')
        assert u.z <= l.z+.0008, (x,y,'receiver seam gap',u.z,l.z)
# The deflector must be behind, rather than centrally across, the port.
deflector = bpy.data.objects['Shell deflector'].evaluated_get(deps)
assert max((deflector.matrix_world@Vector(p)).x for p in deflector.bound_box) < .0305
# Geometry/UV finite and editable without dependency on generated export copies.
for o in scene.objects:
    if o.type != 'MESH':
        continue
    assert o.data.uv_layers, o.name
    for vertex in o.data.vertices:
        assert all(math.isfinite(v) for v in vertex.co), o.name
print('MPX saved source: packed 1K maps, barrel/can datums, open M-LOK slots, closed receiver seam and clear ejection port verified; animation/gameplay/human approval pending')
