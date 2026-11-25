"""Independent saved-source geometry/native animation checks, not visual sign-off.
blender -b .cache/blender/weapons/sig-mpx/mpx.blend --python-exit-code 1 --python tools/blender/mpx/check.py
"""
import json
import math
import sys
from pathlib import Path
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
assert clips['Inspect']['duration'] == 2.45 and clips['Draw']['duration'] == .52 and clips['Holster']['duration'] == .34
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
assert not any('ROMEO4T' in o.name or 'SRD9' in o.name or 'lens_cap' in o.name for o in scene.objects)
assert abs(point('sight').z-.074) < EPS
assert (point('front_post')-point('sight')).cross(Vector((1,0,0))).length < EPS
assert abs(point('muzzle').x-point('barrel_crown').x-.006) < EPS
for name in ('IRON_sights', 'IRON_sights_removed', 'MUZZLE_device', 'MUZZLE_device_removed'):
    assert bpy.data.objects[name].parent.name == 'receiver', (name,'lost rigid assembly ownership')
for name,loc in [('optic',(.025,0,.044)),('muzzle',(.3162,0,0))]:
    mount = bpy.data.objects['MOUNT_'+name]
    assert mount.parent.name == 'receiver'
    assert (mount.matrix_world.translation-Vector(loc)).length < EPS
    assert (mount.matrix_world.to_3x3()@Vector((0,1,0))-Vector((1,0,0))).length < EPS
# Open crown and both interchangeable external muzzle parts retain a 9mm bore.
for name in ('External barrel','Muzzle thread protector','MPX suppressor adapter sleeve'):
    assert tree(name).ray_cast(Vector((.34,0,0)),Vector((-1,0,0)),.05)[0] is None, (name,'blocked crown')
rear = tree('Rear iron aperture')
for y,z in ((0,0),(.0016,0),(-.0016,0),(0,.0016),(0,-.0016)):
    assert rear.ray_cast(point('sight')+Vector((-.02,y,z)),Vector((1,0,0)),.04)[0] is None, 'blocked iron aperture'
assert rear.ray_cast(point('sight')+Vector((-.02,.002,0)),Vector((1,0,0)),.04)[0] is not None, 'missing rear peep rim'
post = bpy.data.objects['Front iron post'].evaluated_get(deps)
assert abs(max((post.matrix_world@Vector(p)).z for p in post.bound_box)-point('sight').z) < EPS
assert point('ejection').y < -.02
# Through-side slots must not be black painted rectangles.
hg_obj = bpy.data.objects['Hollow five-slot M-LOK handguard']
hg = tree(hg_obj.name)
for x in (.119,.148,.190,.232,.274):
    assert hg.ray_cast(Vector((x,-.06,-.001)),Vector((0,1,0)),.12)[0] is None, (x,'closed M-LOK slot')
# Solid lands between slots still exist; test at a web with two distinct walls.
assert hg.ray_cast(Vector((.129,-.06,-.001)),Vector((0,1,0)),.12)[0] is not None
# Probe both ends and edges of the angled backing on solid chamfer lands.
backing = tree('Laser rail adapter web')
rail_frame = bpy.data.objects['MOUNT_rail'].matrix_world
inward = rail_frame.to_3x3() @ Vector((0,0,1))
for x in (.252,.276):
    for across in (-.004,.004):
        p = rail_frame @ Vector((across,x-rail_frame.translation.x,0))
        guard_hit = hg.ray_cast(p,inward,.03)[0]
        plate_hit = backing.ray_cast(p+.03*inward,-inward,.03)[0]
        assert guard_hit is not None and plate_hit is not None, ('unsupported laser adapter',x,across)
        assert -.0001 <= (plate_hit-guard_hit).dot(inward) < .001, ('laser backing not seated',x,across)
assert backing.overlap(tree('Laser rail adapter groove bed')), 'rail not seated on its backing'
front = max((hg_obj.matrix_world @ Vector(p)).x for p in hg_obj.bound_box)
for obj in scene.objects:
    if obj.type == 'MESH' and obj.name.startswith('Laser rail adapter'):
        assert max((obj.matrix_world @ Vector(p)).x for p in obj.bound_box) < front, (obj.name,'rail overhangs handguard')
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
# Geometry/UV finite and editable without dependency on generated export copies.
for o in scene.objects:
    if o.type != 'MESH':
        continue
    assert o.data.uv_layers, o.name
    for vertex in o.data.vertices:
        assert all(math.isfinite(v) for v in vertex.co), o.name
print('MPX saved source: maps/datums/slots/seams/port, mounted trigger, reference-mag silhouette, decals, open crown/removable deployed irons, eight native control/shared-review-arm clips and retained/empty reload events verified; human animation/gameplay approval pending')

# Actual shared rail attachment, independent of the optic catalog.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tor_mini.mounts import check_laser_mount
check_laser_mount('mpx')

# Mount every actual shared asset; do not substitute proxy attachment bounds.
rig = bpy.data.objects['MPX_RIG']
weapon = [o for o in bpy.data.collections['MPX | editable exterior components'].objects if o.type == 'MESH']
hands = [o for o in scene.objects if o.type == 'MESH' and any('authored hands' in c.name for c in o.users_collection)]
assert hands, 'missing deformed review skins'
import attachment_source
from attachment_source import surface


def select(name, time=0):
    for obj in scene.objects:
        if obj.animation_data:
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name
    frame = time*scene.render.fps
    scene.frame_set(math.floor(frame),subframe=frame%1)
    bpy.context.view_layer.update()

select('Idle')
# Hidden replacement geometry is evaluated for checks, but not shown in source review.
for name in ('IRON_sights_removed','MUZZLE_device_removed'):
    bpy.data.objects[name].hide_viewport = False
bpy.context.view_layer.update()
mounted = {}
loaded = []
for id,slot in [*((id,'optic') for id in attachment_source.OPTICS),('srd762ti','muzzle'),('laser','rail')]:
    objects,base = attachment_source.load(id)
    mesh = [o for o in objects if o.type == 'MESH']
    seating = bpy.data.objects['MOUNT_'+slot].matrix_world @ base.matrix_world.inverted()
    mounted[id] = surface(mesh,rig.matrix_world.inverted() @ seating)
    if slot == 'rail':
        for obj in mesh:
            world = seating @ obj.matrix_world
            assert max((world @ Vector(p)).x for p in obj.bound_box) < front, (obj.name,'laser overhangs handguard')
    if slot == 'optic':
        irons = surface([o for o in bpy.data.objects['IRON_sights'].children if o.type=='MESH'],rig.matrix_world.inverted())
        clash = bool(mounted[id].overlap(irons))
        assert clash == (id == 'scope'), (id,'opticClashes mismatch',clash)
        folded = [o for o in bpy.data.objects['IRON_sights_removed'].children if o.type == 'MESH']
        assert not mounted[id].overlap(surface(folded,rig.matrix_world.inverted())), (id,'hits folded removed state')
    loaded.extend(objects)

sight = rig.matrix_world.inverted() @ point('sight')
assert mounted['laser'].ray_cast(sight,Vector((1,0,0)),1)[0] is None, 'laser blocks iron sight line'

# Check each enabled state against fixed receiver/guard and moving mechanisms.
# Deliberate rail-foot mating is the only optic contact exemption.
fixed = [o for o in weapon if o.parent and o.parent.name == 'receiver'
         and not o.name.startswith('Picatinny')]
for id,target in mounted.items():
    for obj in fixed:
        if id=='laser' and obj.name.startswith('Laser rail adapter tooth'): continue  # precise contact checked above
        assert not target.overlap(surface([obj],rig.matrix_world.inverted())), (id,obj.name,'attachment hits base weapon')
    if id == 'srd762ti':
        assert not target.overlap(surface(list(bpy.data.objects['MUZZLE_device_removed'].children),rig.matrix_world.inverted())), 'suppressor hits adapter'
        # A 9mm round plus .6mm radial margin must pass the actual endcap/shadow.
        for i in range(32):
            a=i*math.tau/32
            assert target.ray_cast(Vector((.56,.0051*math.cos(a),.0051*math.sin(a))),Vector((-1,0,0)),.24)[0] is None, 'suppressor bore obstructed'

# Catalog slots coexist: compare optics against the mounted laser and can,
# plus rail/muzzle against each other (never compare alternative optics).
for optic in attachment_source.OPTICS:
    for other in ('laser','srd762ti'):
        assert not mounted[optic].overlap(mounted[other]), (optic,other,'slot attachments intersect')
assert not mounted['laser'].overlap(mounted['srd762ti']), 'rail/muzzle intersection'
for name in ('IRON_sights','IRON_sights_removed'):
    parts=[o for o in bpy.data.objects[name].children if o.type=='MESH']
    mounted[name]=surface(parts,rig.matrix_world.inverted())

poses=0
moving = [o for o in weapon if o.parent and o.parent.name in ('bolt','charging_handle','magazine','magazine_spare','magazine_rounds','magazine_spare_rounds','trigger','bolt_release','magazine_catch')]
for name,info in clips.items():
    for sample in range(math.ceil(info['duration']*120)+1):
        select(name,min(sample/120,info['duration']))
        inverse = rig.matrix_world.inverted()
        for obj in moving+hands:
            moving_surface=None
            if min(obj.scale)<.001: continue
            evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            bounds=[inverse@evaluated.matrix_world@Vector(p) for p in evaluated.bound_box]
            for id,target in mounted.items():
                # Broad phase excludes objects clearly below the optic rail or behind the muzzle.
                if id=='srd762ti':
                    if max(p.x for p in bounds)<.316: continue
                elif id!='laser' and (max(p.z for p in bounds)<.041 or max(p.x for p in bounds)<-.16): continue
                elif id=='laser': continue  # separate 120Hz TOR sweep includes precise mating/emitter checks
                if moving_surface is None: moving_surface=surface([obj],inverse)
                assert not target.overlap(moving_surface), (name,sample,id,obj.name,'mechanism/hand hits attachment')
        poses+=1
select('Idle')
# No fold or charging clip exists. Independently sweep the actual stock hinge
# and non-reciprocating handle through 180 degrees / 38mm respectively.
stock=[o for o in weapon if o.parent and o.parent.name=='stock_hinge']
handle=[o for o in weapon if o.parent and o.parent.name=='charging_handle']
pivot=Vector((-.122,.015,.004))
for angle in range(181):
    transform=Matrix.Translation(pivot)@Matrix.Rotation(math.radians(angle),4,'Z')@Matrix.Translation(-pivot)
    for id,target in mounted.items():
        assert not target.overlap(surface(stock,transform)), (angle,id,'stock fold hits attachment')
for sample in range(39):
    transform=Matrix.Translation((-.001*sample,0,0))
    for id,target in mounted.items():
        assert not target.overlap(surface(handle,transform)), (sample,id,'charging handle hits attachment')
for obj in loaded: bpy.data.objects.remove(obj,do_unlink=True)
print('MPX_ATTACHMENT_CLEARANCE_OK:',poses,'120Hz mechanism/deformed-hand poses; 181 fold and 39 charging poses; all catalog fits, optic seating, folded/deployed iron clashes, 9mm muzzle clearance')
