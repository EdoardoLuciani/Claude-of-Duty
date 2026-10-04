"""Independent saved-mesh/action checks, not regeneration from tuning values."""
import json
import math
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];CI=Matrix(((1,0,0),(0,0,-1),(0,1,0))).inverted()
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
scope=points('PM II scope housing');z=[p.z for p in scope]
assert abs(max(z)-min(z)-.417)<.00001
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
print('AX338 saved source: measured barrel/overall/scope, source UV/packed maps, measured magazine/cartridge fit and connected butt guides, true KeySlot, native 60-degree/100 mm bolt and synchronized wrist skins passed')
