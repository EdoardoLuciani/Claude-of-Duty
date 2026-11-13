"""Independent saved-mesh/action checks, not regeneration from tuning values."""
import json
import math
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[3];CI=Matrix(((1,0,0),(0,0,-1),(0,1,0))).inverted()
scene=bpy.context.scene;rig=bpy.data.objects['AX338_RIG']
manifest=json.loads((ROOT/'assets/weapons/ax338/manifest.json').read_text())
def select(clip,time=0):
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data.action=None
            for t in o.animation_data.nla_tracks:t.mute=t.name!=clip
    frame=time*120;scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()
def points(name):
    o=bpy.data.objects[name];return [CI@(o.matrix_world@v.co) for v in o.data.vertices]
select('Idle')
barrel=points('27 inch barrel');z=[p.z for p in barrel]
assert abs(max(z)-min(z)-.6858)<.00001,(min(z),max(z))
all_points=[]
for o in bpy.data.collections['AX338 | authored components'].objects:
    if o.type=='MESH' and o.parent and o.parent.name not in ('magazine_spare','magazine_spare_round'):
        all_points.extend(CI@(o.matrix_world@v.co) for v in o.data.vertices)
z=[p.z for p in all_points];assert abs(max(z)-min(z)-1.250)<.00001,(min(z),max(z))
# Geometry-derived magazine envelopes must match the editable saved meshes,
# not a separately invented wrist/contact proxy.
for entry in manifest['contactGeometry']['magazine']:
    p=points(entry['part'])
    for i in range(3):
        assert abs(min(v[i] for v in p)-entry['min'][i])<.000001
        assert abs(max(v[i] for v in p)-entry['max'][i])<.000001
p=points('Magazine steel body')
for i,size in enumerate((.034,.105,.104)):
    assert abs(max(v[i] for v in p)-min(v[i] for v in p)-size)<.00001
# Cartridge front/back now fit inside the body instead of projecting 20 mm out.
rounds=points('Visible .338 cartridge');assert min(p.z for p in rounds)>min(p.z for p in points('Magazine steel body'))
assert max(p.z for p in rounds)<max(p.z for p in points('Magazine steel body'))
# Both real extension guides bridge housing/carrier to the butt spacer.
def bounds(name):
    p=points(name);return [(min(v[i] for v in p),max(v[i] for v in p)) for i in range(3)]
def overlap(a,b):return all(min(a[i][1],b[i][1])>max(a[i][0],b[i][0]) for i in range(3))
def touches(a,b):
    def tree(name):
        o=bpy.data.objects[name];return BVHTree.FromPolygons(points(name),[tuple(p.vertices) for p in o.data.polygons])
    return bool(tree(a).overlap(tree(b)))
guides=[o.name for o in bpy.data.objects if o.name.startswith('Butt extension guide')]
assert len(guides)==2
for name,front in zip(sorted(guides),('Stock carrier','Butt adjustment housing')):
    assert overlap(bounds(name),bounds(front)) and overlap(bounds(name),bounds('Butt spacer')),(name,'floating guide/pad assembly')
    assert touches(name,front) and touches(name,'Butt spacer'),(name,'disconnected actual guide surfaces')
assert touches('Pistol grip spine','Tan trigger guard'),'disconnected pistol grip neck'
assert touches('Receiver stock mount','Steel flat-bottom action'),'mount does not reach receiver'
assert touches('Receiver stock mount','Stock hinge'),'stock hinge still detached from gun'
for suffix in ('','.001'):
    assert touches('Stock hinge','Dark Earth stockside'+suffix),'hinge does not reach stockside'
assert touches('Receiver stock mount','Tan trigger guard'),'grip housing disconnected from mount'
assert touches('Stock hinge','Stock carrier'),'entry does not reach central stock spine'
# Check the sized entry, not just a few overlapping surfaces. The old carrier
# hung 21.5 mm below the throat and the 47 x 32 mm sideways drum masked its fit.
entry=points('Stock hinge');carrier=points('Stock carrier')
assert abs(max(p.x for p in entry)-min(p.x for p in entry)-.027)<.0002
assert abs(max(p.y for p in entry)-min(p.y for p in entry)-.023)<.0002
assert min(p.y for p in carrier if p.z<.134)>=.034-.0001,'carrier still hangs below stock entry'
for name in ('Hinge receiver leaf','Hinge stock leaf'):
    for suffix in ('','.001'):
        assert touches(name+suffix,'Stock hinge'),'detached hinge leaf'
        assert touches(name+suffix,'Receiver stock mount' if name=='Hinge receiver leaf' else 'Dark Earth stockside'+suffix),'detached leaf mount'
assert touches('Hinge pin','Hinge knuckle') and touches('Hinge pin','Hinge knuckle.001'),'detached folding pin'
# Inspect actual saved-mesh cross-sections, not only the author's control data.
def edges(y):
    o=bpy.data.objects['Pistol grip spine'];p=points(o.name);hits=[]
    for edge in o.data.edges:
        a,b=(p[v] for v in edge.vertices)
        if min(a.y,b.y)<=y<=max(a.y,b.y) and abs(b.y-a.y)>1e-9:
            hits.append(a.z+(b.z-a.z)*(y-a.y)/(b.y-a.y))
    assert hits,('missing grip section',y)
    return min(hits),max(hits)
neck=edges(.0141);heel=edges(-.0487)
assert heel[1]-heel[0]>neck[1]-neck[0]+.014,'straight narrow handle substituted for fuller curved heel'
assert abs(edges(-.0563)[0]-edges(-.040)[0])<.002,'lower front strap must turn nearly vertical'
assert heel[1]>neck[1]+.030,'rear strap does not bow into the heel'
# Correct shallow guard aperture and shortened forward-curving trigger.
trigger=points('Curved trigger');assert abs(min(p.y for p in trigger)+.007)<.001
assert max(p.z for p in trigger if p.y<0)<min(p.z for p in trigger if p.y>.035)-.004
v,f=points('Tan trigger guard'),bpy.data.objects['Tan trigger guard'].data.polygons
tree=BVHTree.FromPolygons(v,[tuple(p.vertices) for p in f])
assert tree.ray_cast(Vector((-.050,.009,.016)),Vector((1,0,0)),.10)[0] is None,'guard aperture closed'
assert tree.ray_cast(Vector((-.050,.037,.016)),Vector((1,0,0)),.10)[0] is not None,'old tall aperture retained'
for suffix in ('','.001'):
    anchor='Panel inboard anchor'+suffix
    assert touches(anchor,'Tan forward grip panel'+suffix) and touches(anchor,'Octagonal slotted forend'),(anchor,'floating panel')
for o in bpy.data.collections['AX338 | authored components'].objects:
    if o.type=='MESH':assert o.data.uv_layers and o.data.polygons,'Missing source UV/geometry: '+o.name
assert all(im.packed_file for im in bpy.data.images if im.name.startswith('ax338_'))
# A ray through a known slot must pass through the physical forend wall.
tube=bpy.data.objects['Octagonal slotted forend'];inverse=tube.matrix_world.inverted()
origin=inverse@Vector((-.050,.200,.064));direction=inverse.to_3x3()@Vector((1,0,0))
# Blender coordinates above: game -Z forward is Blender +Y.
hit,*_=tube.ray_cast(origin,direction,distance=.1)
assert not hit,'KeySlot is filled; a dark surface is not a true opening'
bolt=bpy.data.objects['bolt'];rest=bolt.location.copy();restq=bolt.rotation_quaternion.copy()
select('Bolt_Cycle',.22*1.1)
assert abs((CI@(bolt.location-rest)).z-.100)<.00001
assert abs(bolt.rotation_quaternion.angle- math.pi/3)<.00001
# Finger/wrist authored actions, not runtime-only procedural clip fallback.
for name,info in manifest['clips'].items():
    assert any(t.name==name for t in rig.animation_data.nla_tracks)
    for t in (0,info['duration']*.25,info['duration']*.5,info['duration']*.75,info['duration']):
        select(name,t)
        for prefix in ('L','R'):
            hand=bpy.data.objects['hand_'+prefix]
            assert all(math.isfinite(v) for v in hand.matrix_world.translation)
        # The preview arm skin and exported wrist control share the same datum.
        for side,prefix in [('left','L'),('right','R')]:
            arm=bpy.data.objects['AX338_arm_'+side]
            wrist=arm.matrix_world@arm.pose.bones['hand'].matrix
            target=bpy.data.objects['hand_'+prefix].matrix_world.translation
            assert (wrist.translation-target).length<.0003,(name,t,side,(wrist.translation-target).length)
# The holding fingers must wrap against the grip with their actual distal skin;
# MCP/root proximity alone allowed the earlier visibly open grasp to pass.
grip_parts=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith(('Pistol grip spine','Grip stipple'))]
skins=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('AX338_right_')]
maximum_grasp_gap=0
for clip,time in [('Idle',0),('Fire',.055),('Last_Shot',.055),('Reload_Tactical',1.4),('Reload_Empty',1.8),('Inspect',1.6),('Draw',.88),('Holster',0)]:
    select(clip,time);deps=bpy.context.evaluated_depsgraph_get();inverse=rig.matrix_world.inverted()
    vertices=[];faces=[]
    for o in grip_parts:
        offset=len(vertices);vertices.extend(inverse@(o.matrix_world@v.co) for v in o.data.vertices)
        faces.extend(tuple(offset+i for i in p.vertices) for p in o.data.polygons)
    target=BVHTree.FromPolygons(vertices,faces);gaps=[float('inf')]*3;finger_vertices=[];finger_faces=[[],[],[]]
    for o in skins:
        evaluated=o.evaluated_get(deps);m=evaluated.to_mesh();positions=[inverse@(evaluated.matrix_world@v.co) for v in m.vertices]
        offset=len(finger_vertices);finger_vertices.extend(positions)
        for i in range(1,4):
            distal_ids={v.index for v in o.data.vertices if sum(group.weight for group in v.groups if o.vertex_groups[group.group].name.startswith((f'finger_{i}_1',f'finger_{i}_2')))>.7}
            finger_faces[i-1].extend(tuple(offset+j for j in face.vertices) for face in m.polygons if all(j in distal_ids for j in face.vertices))
            ids={v.index for v in o.data.vertices if any(group.weight>.2 and o.vertex_groups[group.group].name.startswith(f'finger_{i}_2') for group in v.groups)}
            probes=[positions[j] for j in ids]
            for face in m.polygons:
                if not all(j in ids for j in face.vertices):continue
                probes.append(sum((positions[j] for j in face.vertices),Vector())/len(face.vertices))
                probes.extend((positions[a]+positions[b])*.5 for a,b in face.edge_keys)
            for p in probes:
                gaps[i-1]=min(gaps[i-1],target.find_nearest(p)[3])
        evaluated.to_mesh_clear()
    finger_trees=[BVHTree.FromPolygons(finger_vertices,faces) for faces in finger_faces]
    for a,b in ((0,1),(0,2),(1,2)):
        assert not finger_trees[a].overlap(finger_trees[b]),(clip,time,'holding-finger PIP/DIP skins cross',a+1,b+1)
    assert max(gaps)<.004,(clip,time,'middle/ring/little distal skin loses grip contact',gaps)
    maximum_grasp_gap=max(maximum_grasp_gap,max(gaps))
print('Actual distal middle/ring/little grip contact: maximum gap',round(maximum_grasp_gap*1000,3),'mm')
select('Idle')
assert (bolt.location-rest).length<.00001 and bolt.rotation_quaternion.angle<.00001
print('AX338 saved source: measured barrel/overall, source UV/packed maps, measured magazine/cartridge fit and connected butt guides, true KeySlot, native 60-degree/100 mm bolt and synchronized wrist skins passed')

# Standalone optics use their rail-contact origins, exactly as the runtime mount
# solver does. Read freshly generated editable products, never a copied rifle optic.
select('Idle')
assert 'optic' not in bpy.data.objects and not any('optical glass' in o.name for o in rig.children_recursive)
irons=bpy.data.objects['IRON_sights']
iron_meshes=[o for o in irons.children if o.type=='MESH']
assert iron_meshes and all(o.parent==irons for o in iron_meshes)
def geometry(objects,transform=None,evaluated=False):
    vertices=[];faces=[];deps=bpy.context.evaluated_depsgraph_get()
    inverse=rig.matrix_world.inverted()
    for o in objects:
        ev=o.evaluated_get(deps) if evaluated else None
        mesh=ev.to_mesh() if ev else o.data
        matrix=transform@o.matrix_world if transform is not None else inverse@o.matrix_world
        offset=len(vertices);vertices.extend(matrix@v.co for v in mesh.vertices)
        mesh.calc_loop_triangles()
        faces.extend(tuple(offset+i for i in face.vertices) for face in mesh.loop_triangles)
        if ev:ev.to_mesh_clear()
    return vertices,faces
def surface(objects,transform=None,evaluated=False):
    v,f=geometry(objects,transform,evaluated)
    return BVHTree.FromPolygons(v,f,all_triangles=True)
def datum(name):return CI@(rig.matrix_world.inverted()@bpy.data.objects[name].matrix_world.translation)
def near(a,b):assert (Vector(a)-Vector(b)).length<.000001,(a,b)
near(datum('MOUNT_optic'),(0,.118,-.089))
near(datum('MOUNT_muzzle'),(0,.075,-.7958))
near(datum('MOUNT_rail'),(.027,.075,-.455))
near(datum('SOCKET_sight'),(0,.151,.055))
rear=surface([bpy.data.objects['Rear open aperture']])
origin=Vector((0,-.070,.151));direction=Vector((0,1,0))
assert rear.ray_cast(origin,direction,.020)[0] is None,'rear aperture blocked'
body_meshes=[o for o in rig.children_recursive if o.type=='MESH' and o not in iron_meshes]
assert surface(body_meshes).ray_cast(origin,direction,.609)[0] is None,'base iron sight line obstructed'
post=points('Front sight post');near((0,max(p.y for p in post),min(p.z for p in post)+.001),(0,.151,-.540))
for foot in [o for o in iron_meshes if o.name.startswith('Iron rail foot')]:
    assert abs(min(p.y for p in points(foot.name))-.118)<.000001,'floating iron foot'
rail_teeth=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('Rail tooth')]
assert any(abs(max(p.y for p in points(o.name))-.118)<.000001 for o in rail_teeth)
iron_tree=surface(iron_meshes)
mounted={}
for optic_id,folder in [('rmr','trijicon-rmr'),('acog','trijicon-acog'),('scope','schmidt-bender-pm-ii'),('exps3','eotech-exps3-0')]:
    path=ROOT/'assets/attachments'/folder/(('exps3-0' if optic_id=='exps3' else optic_id)+'.blend')
    with bpy.data.libraries.load(str(path)) as (source,target):target.objects=source.objects
    objects=[o for o in target.objects if o is not None]
    base=next(o for o in objects if o.name.split('.')[0]=='MOUNT_base')
    root=base.parent
    # EXPS3 retains hidden high-poly bake authority beside its runtime root.
    if optic_id=='exps3':objects=[root,*root.children_recursive]
    meshes=[o for o in objects if o.type=='MESH']
    assert not any(o.animation_data for o in objects),(optic_id,'standalone optic contains weapon animation')
    for o in objects:scene.collection.objects.link(o)
    bpy.context.view_layer.update()
    mount=rig.matrix_world.inverted()@bpy.data.objects['MOUNT_optic'].matrix_world
    transform=mount@Matrix.Translation(-base.matrix_world.translation)
    mounted[optic_id]=surface(meshes,transform)
    if optic_id=='scope':
        housing=[o for o in meshes if o.name.startswith('PM II scope housing')]
        v,_=geometry(housing,transform)
        assert abs(max(p.y for p in v)-min(p.y for p in v)-.417)<.000001,'standalone PM II length changed'
    hits=iron_tree.overlap(mounted[optic_id])
    assert bool(hits)==(optic_id=='scope'),(optic_id,'opticClashes must match actual iron intersections',len(hits))
    # Contact plane is authored at zero; the ACOG's projecting clamp screw is
    # intentionally below its shoe. Verify the actual foot, not that screw.
    if optic_id=='exps3':
        # Baked EXPS3 body includes projecting clamp jaws. Probe the actual
        # flat saddle underside, not the lowest jaw or the glass/housing bounds.
        for x in (-.007,0,.007):
            for y in (.069,.089,.109):
                contact=mounted[optic_id].ray_cast(Vector((x,y,.115)),Vector((0,0,1)),.005)[0]
                assert contact is not None and abs(contact.z-.118)<1e-7,'EXPS3 saddle not seated'
        fixed=[o for o in body_meshes if not o.name.startswith('Rail tooth')]
        assert not mounted[optic_id].overlap(surface(fixed)),'EXPS3 crosses non-mating body'
    else:
        foot_name={'rmr':'Riser side','acog':'ACOG rail shoe','scope':'AI mount base'}[optic_id]
        feet=[o for o in meshes if o.name.startswith(foot_name)]
        assert feet,(optic_id,'missing mount foot')
        v,_=geometry(feet,transform)
        assert abs(min(p.z for p in v)-.118)<.00011,(optic_id,'optic not seated on rail')
    print('AX338_OPTIC_FIT',optic_id,'iron triangle contacts',len(hits))

bolt_parts=[o for o in bpy.data.objects if o.type=='MESH' and o.parent==bolt]
stock=bpy.data.objects['stock'];stock_parts=[o for o in stock.children if o.type=='MESH']
hands=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith(('AX338_left_','AX338_right_'))]
mechanical_poses=0;hand_poses=0
for name,info in manifest['clips'].items():
    for frame in range(math.ceil(info['duration']*120)+1):
        select(name,min(frame/120,info['duration']));mechanical_poses+=1
        moving=surface(bolt_parts)
        for optic_id,target in mounted.items():
            assert not moving.overlap(target),(name,frame,optic_id,'bolt hits optic')
        assert not moving.overlap(iron_tree),(name,frame,'bolt hits irons')
        # EXPS3 also checks both actual deformed review arms at native 120 Hz.
        moving=surface(hands,evaluated=True)
        assert not moving.overlap(mounted['exps3']),(name,frame,'exps3','hand/sleeve hits optic')
        # Existing optics retain their 24 Hz plus endpoint hand sweep.
        if frame%5==0 or frame==math.ceil(info['duration']*120):
            hand_poses+=1
            for optic_id,target in mounted.items():
                assert not moving.overlap(target),(name,frame,optic_id,'hand/sleeve hits optic')
            assert not moving.overlap(iron_tree),(name,frame,'hand/sleeve hits irons')
select('Idle')
# The rifle has no authored fold clip: separately sweep the stock's actual left
# hinge through 180 degrees at 1-degree intervals, without inventing an action.
pivot=Vector((-.019,-.1165,.0445))
for angle in range(181):
    transform=Matrix.Translation(pivot)@Matrix.Rotation(-math.radians(angle),4,'Z')@Matrix.Translation(-pivot)
    moving=surface(stock_parts,transform)
    for optic_id,target in mounted.items():
        assert not moving.overlap(target),(angle,optic_id,'folding stock hits optic')
    assert not moving.overlap(iron_tree),(angle,'folding stock hits irons')
print('AX338_ATTACHMENT_CLEARANCE_OK:',mechanical_poses,'120 Hz bolt poses;',hand_poses,'24 Hz deformed-hand poses; 181 stock fold poses; rmr/acog/scope/exps3 and irons; EXPS3 hands at native 120 Hz')
