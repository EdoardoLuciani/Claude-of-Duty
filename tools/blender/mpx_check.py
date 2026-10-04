"""Independent saved-source geometry/native animation checks, not visual sign-off.
blender -b assets/weapons/sig-mpx/mpx.blend --python-exit-code 1 --python tools/blender/mpx_check.py
"""
import json
import math
import bpy
from mathutils import Vector, Matrix
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
required = {'Idle', 'Fire', 'Last_Shot', 'Reload_Tactical', 'Reload_Empty', 'Inspect', 'Draw', 'Holster'}
clips = json.loads(scene['clips'])
assert set(clips) == required
for name in ['MPX_RIG', 'bolt', 'trigger', 'magazine', 'magazine_spare', 'hand_L', 'hand_R', 'MPX_arm_left', 'MPX_arm_right']:
    assert {t.name for t in bpy.data.objects[name].animation_data.nla_tracks} == required, name
assert clips['Reload_Tactical']['duration'] == 1.85 and clips['Reload_Empty']['duration'] == 2.5
assert clips['Inspect']['duration'] == 2.9 and clips['Draw']['duration'] == .52 and clips['Holster']['duration'] == .34
assert not any(e['event'] == 'magdrop' for e in clips['Reload_Tactical']['events'])
assert sum(e['event'] == 'magdrop' for e in clips['Reload_Empty']['events']) == 1
scene.frame_set(0)
bpy.context.view_layer.update()

deps = bpy.context.evaluated_depsgraph_get()

def tree(name):
    # A silhouette can span real assembled parts, such as shell + floor plate.
    names = [name] if isinstance(name,str) else name
    vertices,faces = [],[]
    for part in names:
        o = bpy.data.objects[part].evaluated_get(deps)
        mesh = o.to_mesh()
        offset = len(vertices)
        vertices.extend(o.matrix_world@v.co for v in mesh.vertices)
        faces.extend(tuple(i+offset for i in p.vertices) for p in mesh.polygons)
        o.to_mesh_clear()
    return BVHTree.FromPolygons(vertices,faces,all_triangles=False)


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
# User visual feedback regressions: trigger root is seated in the receiver,
# magazine well touches the assembly, markings lie on the intended surface,
# and both covers have physically attached hinge/pivot/bridge assemblies.
trigger = tree('Curved trigger blade')
assert trigger.overlap(lower), 'trigger blade hangs clear of the lower receiver'
well = tree('Flared 9mm magazine well')
for x in (.049,.067,.085):
    for y in (-.018,.018):
        u = upper.ray_cast(Vector((x,y,-.10)),Vector((0,0,1)),.20)[0]
        w = well.ray_cast(Vector((x,y,.04)),Vector((0,0,-1)),.20)[0]
        assert u and w and u.z <= w.z+.0008, (x,y,'assembly/magazine-well gap')
# Independently measure visible mag silhouette at fixed nominal reference rows.
# Bounds come from PDF25's labelled base, not from the generated manifest.
# Six pixels (~4.8mm) permits compressed-photo AA/perspective, not certification.
# Row480 in the photo includes the floor-plate nose, not just the shell.
# Compare the complete visible magazine rather than relaxing the fixed bounds.
magazine = tree(['Curved 30-round magazine shell','Magazine floor plate'])
assert tree('Curved 30-round magazine shell').overlap(tree('Magazine floor plate')), 'detached floor plate'
S = .660/820
for row,back,front in [(355,789,842),(390,800,855),(430,815,871),(460,829,887),(480,839,897)]:
    z = (232-row)*S
    a = magazine.ray_cast(Vector((-.3,0,z)),Vector((1,0,0)),.7)[0]
    b = magazine.ray_cast(Vector((.4,0,z)),Vector((-1,0,0)),.7)[0]
    assert a and b, (row,'missing magazine section')
    assert abs(a.x-((back-710)*S)) <= 6*S, (row,'mag rear silhouette',a.x)
    assert abs(b.x-((front-710)*S)) <= 6*S, (row,'mag front silhouette',b.x)
# The feeding end is an actual opening, not a cap painted to look hollow.
neck = (808-710)*S
assert tree('Curved 30-round magazine shell').ray_cast(Vector((neck,0,0)),Vector((0,0,-1)),.052)[0] is None, 'sealed magazine feeding end'
for name in ['Extended magazine feed lip','Extended magazine feed lip.001']:
    assert tree(name).overlap(tree('Curved 30-round magazine shell')), 'feed lip not seated on the shell'
assert bpy.data.objects['Decorative loaded cartridge'].parent.name == 'magazine_rounds'
assert bpy.data.objects['magazine_spare_rounds'].parent.name == 'magazine_spare'
label = bpy.data.objects['Mark | MPX 9mm']
assert label.get('decal_target') == 'Flared 9mm magazine well', 'required MPX marking must be surface-fitted'
for o in scene.objects:
    if o.type=='MESH' and 'decal_target' in o and not o.name.startswith('Spare |'):
        surface = tree(o['decal_target'])
        side = o['decal_side']
        for vertex in o.data.vertices:
            p = o.matrix_world@vertex.co
            hit = surface.ray_cast(p+Vector((0,side*.05,0)),Vector((0,-side,0)),.10)[0]
            assert hit is not None, (o.name,'glyph falls outside gun surface')
            assert abs(hit.y-p.y) <= .0004, (o.name,'floating/buried glyph')
# Original ROMEO4T overall dimension includes closed covers. Measure a virtual
# closed pose without changing the maintained open-cover transforms.
closed_x=[]
for tag,side in [('rear',-1),('front',1)]:
    pivot = bpy.data.objects['lens_cap_'+tag]
    pin = bpy.data.objects['Fixed '+tag+' lens hinge pin']
    barrel = bpy.data.objects[tag+' lens cap hinge barrel']
    assert (pin.matrix_world.translation-pivot.matrix_world.translation).length < EPS
    assert (barrel.matrix_world.translation-pivot.matrix_world.translation).length < EPS
    collar = 'Threaded cover mounting collar' + ('.001' if side==1 else '')
    assert tree(pin.name).overlap(tree(collar)), (tag,'hinge floats clear of cover mounting collar')
    for child in pivot.children:
        if child.type != 'MESH': continue
        o = child.evaluated_get(deps)
        closed = pivot.parent.matrix_world@pivot.matrix_parent_inverse@Matrix.Translation(pivot.location)@o.matrix_parent_inverse@o.matrix_basis
        closed_x += [(closed@v.co).x for v in o.data.vertices]
    assert abs(pivot.rotation_euler.y-side*math.radians(120)) < EPS, (tag,'approved open angle changed')
    assert tree(tag+' lens cap hinge bridge').overlap(tree('Open '+tag+' lens cap rim')), (tag,'cover disconnected from hinge bridge')
    cap = bpy.data.objects['Open '+tag+' lens cap rim'].evaluated_get(deps)
    high = max((cap.matrix_world@Vector(p)).z for p in cap.bound_box)
    assert high < point('sight').z-.010, (tag,'open cover obstructs optic aperture')
assert abs(max(closed_x)-min(closed_x)-.0855) < EPS, 'overall length must include closed covers'
planes=[bpy.data.objects[n].matrix_world@bpy.data.objects[n].data.vertices[0].co for n in ['Coated optical lens','Coated optical lens.001']]
assert abs(abs(planes[1].x-planes[0].x)-.064) < EPS, 'inferred lens seats must match staged source datums'
for name in ['Objective and ocular rim','Objective and ocular rim.001']:
    o=bpy.data.objects[name].evaluated_get(deps)
    ys=[(o.matrix_world@v.co).y for v in o.data.vertices]
    assert abs(max(ys)-min(ys)-.027) < EPS, 'drawing-supported rim diameter'
assert tree('ROMEO4T battery cap neck').overlap(tree('ROMEO4T main housing')), 'battery neck must attach to body'
assert tree('ROMEO4T battery cap neck').overlap(tree('ROMEO4T battery cap')), 'battery cap must attach to neck'
# Optical sheets must not become closed alpha-blended discs again. Boolean
# cutters can leave an empty material slot: check faces, not just material names.
for name in ['Coated optical lens','Coated optical lens.001','Open front clear lens cap','Open rear clear lens cap']:
    o = bpy.data.objects[name]
    xs = [v.co.x for v in o.data.vertices]
    assert max(xs)-min(xs) < EPS, (name,'stacked front/back optical surfaces')
for name in ['ROMEO4T main housing','Objective and ocular rim','Objective and ocular rim.001','Open front lens cap rim','Open rear lens cap rim','Threaded cover mounting collar','Threaded cover mounting collar.001']:
    o = bpy.data.objects[name]
    expected = '03 | black moulded polymer' if name.startswith(('Open ','Threaded ')) else '15 | light-absorbing optic interior'
    inward = [p for p in o.data.polygons if p.normal.dot(Vector((0,p.center.y,p.center.z))) < -1e-6]
    assert inward, (name,'missing inner wall')
    assert all(o.data.materials[p.material_index] and o.data.materials[p.material_index].name == expected for p in inward), (name,'unassigned/reflective interior faces')
# Geometry/UV finite and editable without dependency on generated export copies.
for o in scene.objects:
    if o.type != 'MESH':
        continue
    assert o.data.uv_layers, o.name
    for vertex in o.data.vertices:
        assert all(math.isfinite(v) for v in vertex.co), o.name
print('MPX saved source: maps/datums/slots/seams/port, mounted trigger, reference-mag silhouette, decals, attached clear optic covers, eight native control/shared-review-arm clips and retained/empty reload events verified; human animation/gameplay approval pending')
