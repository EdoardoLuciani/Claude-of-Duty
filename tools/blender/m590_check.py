"""Saved editable M590 source checks. Not a runtime/gameplay acceptance claim.
blender -b assets/weapons/m590/m590.blend --python-exit-code 1 --python tools/blender/m590_check.py
"""
import json
import math
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2]
ref=json.loads((ROOT/'assets/weapons/m590/hand-reference.json').read_text())
manifest=json.loads((ROOT/'assets/weapons/m590/manifest.json').read_text())
scene=bpy.context.scene;rig=bpy.data.objects['M590_RIG'];CI=Matrix(((1,0,0),(0,0,1),(0,-1,0))).to_4x4()
assert scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1 and scene.render.fps==120
assert json.loads(scene['clips'])==manifest['clips']
asset=bpy.data.collections['M590 | authored components'];meshes=[o for o in asset.objects if o.type=='MESH']
review=bpy.data.collections['M590 | authored hands (shared appearance)']
assert len([o for o in review.objects if o.type=='ARMATURE'])==2
assert len([o for o in review.objects if o.type=='MESH'])==10
assert not any(o.type in ('LIGHT','CAMERA','ARMATURE') for o in asset.objects)
assert all(im.packed_file for im in bpy.data.images if im.name.startswith('m590-'))
def pose(name,t=0):
    for o in scene.objects:
        if o.animation_data:
            o.animation_data.action=None
            for track in o.animation_data.nla_tracks:track.mute=track.name!=name
    f=t*120;scene.frame_set(math.floor(f),subframe=f-math.floor(f));bpy.context.view_layer.update()
def point(o):return CI@rig.matrix_world.inverted()@o.matrix_world.translation
# Use evaluated rendered triangles, never Boolean-ngon fan approximations.
def tree(objects):
    vertices=[];faces=[];deps=bpy.context.evaluated_depsgraph_get()
    for o in objects:
        ev=o.evaluated_get(deps);data=ev.to_mesh();data.calc_loop_triangles()
        m=CI@rig.matrix_world.inverted()@ev.matrix_world;offset=len(vertices)
        vertices.extend(m@v.co for v in data.vertices);faces.extend(tuple(offset+i for i in f.vertices) for f in data.loop_triangles)
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(vertices,faces,all_triangles=True)
def pick(prefix):return [o for o in meshes if o.name.startswith(prefix)]
def nearest(bvh,p):return bvh.find_nearest(Vector(p))[3]
pose('Idle')
assert rig.location.length<1e-8 and rig.rotation_quaternion.angle<1e-8 and (rig.scale-Vector((1,1,1))).length<1e-8
controls=[o for o in asset.objects if o.type=='EMPTY' and not o.name.startswith(('SOCKET_','DATUM_'))]
# Manufacturer nominal anchors, checked on evaluated exterior and physical datums.
dim=manifest['dimensions'];assert manifest['reference']['sku']=='50774'
assert abs((point(bpy.data.objects['DATUM_closed_breech'])-point(bpy.data.objects['SOCKET_muzzle'])).length-18.5*.0254)<1e-6
assert abs((point(bpy.data.objects['DATUM_trigger_face'])-point(bpy.data.objects['DATUM_butt_center'])).length-13.875*.0254)<1e-6
exterior=[];deps=bpy.context.evaluated_depsgraph_get()
for o in meshes:
    if o.parent.name=='shell_insert':continue
    ev=o.evaluated_get(deps);data=ev.to_mesh();exterior.extend((CI@rig.matrix_world.inverted()@ev.matrix_world@v.co).z for v in data.vertices);ev.to_mesh_clear()
assert abs(max(exterior)-min(exterior)-39.5*.0254)<.0002,'manufacturer nominal OAL'
print('M590_MANUFACTURER_ANCHORS_OK: SKU50774; OAL',max(exterior)-min(exterior),'barrel469.9mm; LOP352.425mm; local photo estimates not certified CAD')
for o in controls:
    assert o==rig or o.parent==rig,o.name
    assert {t.name for t in o.animation_data.nla_tracks}==set(manifest['clips']),o.name
    for t in o.animation_data.nla_tracks:
        assert len(t.strips)==1 and t.strips[0].action_frame_start==0
        for layer in t.strips[0].action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        assert all(math.isfinite(v) for key in curve.keyframe_points for v in key.co)
for name,pos in manifest['sockets'].items():
    o=bpy.data.objects['SOCKET_'+name];assert o.parent==rig
    assert (point(o)-Vector(pos)).length<1e-7,name
receiver=tree(pick('590A1 receiver forging'));rear=tree(pick('Ghost ring'))
# F1 regression: the metal button must be seated on evaluated receiver/tang support,
# not merely close to its own metadata or a floating bounding box.
safety_objects=pick('Tang safety');ridges=pick('Safety traction ridge')
assert len(safety_objects)==1 and len(ridges)==5,'factory safety components required'
safety=tree(safety_objects);support=tree(pick('590A1 receiver forging')+pick('Rear tang'))
assert all(o.active_material.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value==1 for o in safety_objects+ridges),'factory metal safety'
safety_gaps=[]
for x in (-.003,0,.003):
    for z in (.016,.020,.024,.028,.030):
        underside=safety.ray_cast(Vector((x,.060,z)),Vector((0,1,0)),.035)[0]
        seat=support.ray_cast(Vector((x,.095,z)),Vector((0,-1,0)),.040)[0]
        assert underside is not None and seat is not None,('safety support missing',x,z)
        gap=underside.y-seat.y;safety_gaps.append(gap)
        assert -.0004<gap<.00015,('detached tang safety',x,z,gap)
print('M590_SEATED_METAL_SAFETY_OK: 15 support rays; maximum gap',max(safety_gaps)*1000,'mm')
# R1 paired rays measure the actual two mating surfaces, not a nearest filler.
stock=tree(pick('Conventional synthetic stock'));tang=tree(pick('Rear tang'));seam_gaps=[]
for x,y in ((0,.030),(0,.045),(.012,.045),(-.012,.045),(0,.060)):
    metal=receiver.ray_cast(Vector((x,y,.040)),Vector((0,0,-1)),.04)[0]
    polymer=stock.ray_cast(Vector((x,y,0)),Vector((0,0,1)),.06)[0]
    assert metal is not None and polymer is not None,('receiver/stock mating surface missing',x,y)
    gap=polymer.z-metal.z;seam_gaps.append(gap)
    assert abs(gap)<.0002,('receiver/stock seam gap',x,y,gap)
crown_steps=[]
for x in (-.006,0,.006):
    for z in (.036,.038,.039,.041):
        metal=tang.ray_cast(Vector((x,.1,z)),Vector((0,-1,0)),.1)[0]
        polymer=stock.ray_cast(Vector((x,.1,z)),Vector((0,-1,0)),.1)[0]
        assert metal is not None and polymer is not None,('tang/crown transition missing',x,z)
        step=metal.y-polymer.y;crown_steps.append(step)
        assert -.0005<step<.0005,('proud rear tang/crown step',x,z,step)
print('M590_MATED_JUNCTION_OK: 5 paired seam rays; maximum absolute gap',max(abs(g) for g in seam_gaps)*1000,'mm; 12 local crown pairs; maximum absolute step',max(abs(g) for g in crown_steps)*1000,'mm')
# R2 underside rays lock the slanted flat run and the deliberately creased front.
def wrist_bottom(z):
    hit=stock.ray_cast(Vector((0,-.1,z)),Vector((0,1,0)),.2)[0]
    assert hit is not None,('lower wrist missing',z)
    return hit.y
for z in (.073,.081,.094,.101):
    assert abs(wrist_bottom(z)-(-.040+.3*(z-.068)))<.00015,('lower wrist flat/slanted run',z,wrist_bottom(z))
low=wrist_bottom(.068)
assert abs(low+.040)<.0006,'lower wrist neck-low corner'
assert (low-wrist_bottom(.062))/.006<-1.4 and (wrist_bottom(.073)-low)/.005>.15,'lower wrist deliberate corner'
# R3 retain a curved lower/rear guard return; trigger contact is checked below.
guard=tree(pick('Metal trigger guard'))
for z,y in ((-.022,-.015),(-.005,-.016),(.014,-.012),(.022,-.005)):
    hit=guard.ray_cast(Vector((0,-.04,z)),Vector((0,1,0)),.08)[0]
    assert hit is not None and abs(hit.y-y)<.0003,('guard lower/rear curvature',z,hit)
print('M590_LOCAL_WRIST_GUARD_OK: straight lower wrist, neck-low corner, rounded guard return')
# F3 relief is cut into the rubber, not an added row of protruding boxes.
pad=tree(pick('Rubber buttpad'));y=-.041
z=dim['buttCenter'][2]+.006*(y-dim['buttCenter'][1])/.068-.007
for side in (-1,1):
    cavity=pad.ray_cast(Vector((side*.05,y,z)),Vector((-side,0,0)),.05)[0]
    border=pad.ray_cast(Vector((side*.05,y+.00325,z)),Vector((-side,0,0)),.05)[0]
    assert cavity is not None and border is not None
    assert abs(cavity.x)<.019 and abs(border.x)>.022,('actual recessed buttpad lattice',side,cavity,border)
print('M590_BUTTPAD_LATTICE_OK: recessed diamond cavities and rubber border on both sides')
# F4 closed bolt covers the lower window and genuinely withdraws when opened.
visible=pick('Visible bolt surface')+pick('Visible bolt pin')+pick('Visible extractor relief')
assert len(visible)==3 and all(o.parent.name=='bolt' for o in visible),'visible bolt ownership'
assert tree(visible).ray_cast(Vector((.05,.063,-.132)),Vector((-1,0,0)),.05)[0] is not None
pose('Pump',.144)
assert tree(visible).ray_cast(Vector((.05,.063,-.132)),Vector((-1,0,0)),.05)[0] is None,'visible bolt must clear open port'
pose('Idle')
print('M590_MOVING_VISIBLE_BOLT_OK: closed window surface, open window clearance, bolt ownership')
assert receiver.ray_cast(Vector((.05,.063,-.132)),Vector((-1,0,0)),.05)[0] is None,'real right ejection opening'
assert receiver.ray_cast(Vector((0,-.03,-.068)),Vector((0,1,0)),.075)[0] is None,'real belly loading opening'
assert rear.ray_cast(Vector((0,.096,0)),Vector((0,0,-1)),.130)[0] is None,'unblocked ghost-ring bore'
for x,y in ((.004,0),(-.004,0),(0,.004),(0,-.004)):
    assert rear.ray_cast(Vector((x,.096+y,0)),Vector((0,0,-1)),.130)[0] is None
front=pick('Front sight blade')[0];points=[CI@front.matrix_world@v.co for v in front.data.vertices]
assert abs(max(v.y for v in points)-.096)<1e-7 and abs(min(v.x for v in points)+max(v.x for v in points))<1e-7
# Actual mesh surfaces at contact locations: all four support pads + palmar thumb.
forend_objects=[o for o in meshes if o.parent and o.parent.name=='forend'];support=tree(forend_objects)
for p in ref['sides']['left']['pads']+[ref['sides']['left']['thumbPad']]:
    assert nearest(support,p)<.002,('forend contact',p,nearest(support,p))
grip=tree(pick('Conventional synthetic stock'));trigger=tree(pick('Curved trigger'))
for i,p in enumerate(ref['sides']['right']['pads']):
    bvh=trigger if i==0 else grip
    assert nearest(bvh,p)<.003,('firing contact',i,p,nearest(bvh,p))
assert nearest(grip,ref['sides']['right']['thumbPad'])<.003,'conventional neck/thumb support'
assert nearest(tree(pick('Rubber buttpad')),dim['buttCenter'])<.001,'LOP butt datum is on physical rubber face'
assert nearest(trigger,dim['triggerFace'])<.001,'LOP trigger datum is on physical trigger face'
assert nearest(tree(pick('Bolt face')),dim['closedBreech'])<1e-6,'barrel datum is on closed bolt face'
# Rigid mechanism sweep in rig-space against the fixed receiver and barrel.
fixed=tree(pick('590A1 receiver forging')+pick('Heavy barrel')+pick('Barrel crown'))
minimum=math.inf;poses=0;seen=set();skin_poses=0
left_glove=[o for o in review.objects if o.type=='MESH' and o.name.startswith('M590_left_')]
for name in ('Pump','Reload_Empty'):
    d=manifest['clips'][name]['duration']
    for frame in range(math.ceil(d*120)+1):
        pose(name,min(frame/120,d));poses+=1
        stroke=(CI.to_3x3()@bpy.data.objects['forend'].location).z
        assert -.000001<=stroke<=.089001
        if name=='Pump' or frame/120<=.22*d or frame/120>=.78*d:
            assert not tree(left_glove).overlap(fixed),(name,frame,'planted shared glove intersects receiver/barrel')
            skin_poses+=1
        state=round(stroke,8)
        if state in seen:continue
        seen.add(state)
        moving=tree(forend_objects)
        assert not moving.overlap(fixed),(name,frame,'pump/receiver/barrel intersection')
        rear_z=max((CI@rig.matrix_world.inverted()@o.matrix_world@v.co).z for o in pick('Factory ribbed slide') for v in o.data.vertices)
        minimum=min(minimum,-.194-rear_z);assert -.194-rear_z>=.0055
# Source wrists and shell paths are rigidly locked during declared contact beats.
max_drift=0
loading_fixed=tree(pick('590A1 receiver forging')+pick('Elevator shelf')+pick('Magazine tube'))
shell_meshes=[o for o in meshes if o.parent and o.parent.name=='shell_insert']
for name in ('Reload_Tactical','Reload_Empty'):
    a,b=ref['contactWindows'][name]['shell'];d=manifest['clips'][name]['duration']
    for frame in range(math.ceil(a*120),math.floor(b*120)+1):
        pose(name,frame/120);poses+=1
        shell=bpy.data.objects['shell_insert'];wrist=bpy.data.objects['hand_L']
        matrix=CI@rig.matrix_world.inverted()@shell.matrix_world
        local=Vector(ref['shell']['pos'])-Vector(ref['shell']['hullPosition'])
        expected=matrix@CI.inverted()@local;actual=point(wrist);drift=(actual-expected).length
        max_drift=max(max_drift,drift);assert drift<.00001,(name,frame,drift)
        assert shell.scale.x==1
    # Do not hide interpenetration by shrinking a contact window: sweep every
    # visible hull pose and the actual deformed shared glove during insertion.
    visible_end=(.70 if name=='Reload_Empty' else .84)*d
    for frame in range(math.ceil(a*120),math.floor(visible_end*120)+1):
        pose(name,frame/120)
        assert not tree(shell_meshes).overlap(loading_fixed),(name,frame,'hull intersects loading channel')
    a,b=ref['contactWindows'][name]['thumb']
    for frame in range(math.ceil(a*120),math.floor(b*120)+1):
        pose(name,frame/120)
        matrix=CI@rig.matrix_world.inverted()@bpy.data.objects['shell_insert'].matrix_world
        local=Vector(ref['insertion']['pos'])-Vector(ref['shell']['hullPosition'])
        assert (point(bpy.data.objects['hand_L'])-matrix@CI.inverted()@local).length<.00001
    a,b=ref['contactWindows'][name]['insertionClearance']
    glove=[o for o in review.objects if o.type=='MESH' and o.name.startswith('M590_left_')]
    for frame in range(math.ceil(a*120),math.floor(b*120)+1):
        pose(name,frame/120)
        overlaps=tree(glove).overlap(receiver);skin_poses+=1
        assert not overlaps,(name,frame,'actual left glove/sleeve intersects receiver',[o.name for o in glove if tree([o]).overlap(receiver)])
pose('Idle')
print('M590_SOURCE_OK:',len(meshes),'editable component meshes;',len(controls),'native controls;',poses,'120Hz mechanism/contact poses;',len(seen),'distinct strokes;',skin_poses,'actual deformed glove clearance poses; rear clearance',minimum*1000,'mm; wrist/shell drift',max_drift*1000,'mm')
