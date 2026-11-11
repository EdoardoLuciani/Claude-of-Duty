"""EVOLYS mechanism, linked-belt and shared-arm control authoring at 120 Hz.
Visual open-bolt mechanism; gameplay ammunition/chamber rules are unchanged.
"""
import copy
import json
import math
import bpy
from mathutils import Vector, Quaternion, Matrix
from review_hands import author_review_hands

C=Matrix(((1,0,0),(0,0,-1),(0,1,0)));CI=C.inverted();FPS=120

def xyz(v):return C@Vector(v)
def quat(q):return (C@q.to_matrix()@CI).to_quaternion()
def eq(e):return Quaternion((1,0,0),e[0])@Quaternion((0,1,0),e[1])@Quaternion((0,0,1),e[2])

def charging_contact_reference(action,duration):
    """Original neighboring wrist-z keys keep the calibrated charging stroke.

    A released waypoint must not change AUTO_CLAMPED handles inside .82–.88.
    Game -Z is Blender +Y; the five original keys reproduce those handles.
    """
    reference=action.copy()
    curve=next(c for layer in reference.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves if c.data_path=='location' and c.array_index==1)
    curve.keyframe_points.clear()
    for fraction,z in ((.77,-.16),(.80,-.075),(.82,-.068),(.88,-.003),(.93,-.003)):
        point=curve.keyframe_points.insert(fraction*duration*FPS,-z)
        point.interpolation='BEZIER';point.handle_left_type='AUTO_CLAMPED';point.handle_right_type='AUTO_CLAMPED'
    curve.update()
    return reference,curve

def author_actions(root,asset,rig,parts,belt,belt_pos):
    scene=bpy.context.scene
    ref=json.loads((root/'assets/weapons/fn-evolys-762/hand-reference.json').read_text())
    controls=[];hand_controls={};clips={}
    def control(name):
        o=bpy.data.objects.new(name,None);asset.objects.link(o);o.parent=rig;o.rotation_mode='QUATERNION';o.empty_display_size=.004;controls.append(o);return o
    for side,prefix in [('left','L'),('right','R')]:
        values={'wrist':control('hand_'+prefix)}
        for i in range(4):
            values[f'finger_{i}_root']=control(f'{prefix}_finger_{i}_root')
            for j in range(3):values[f'finger_{i}_{j}']=control(f'{prefix}_finger_{i}_{j}')
        for name in ('thumb_base','thumb_0','thumb_1'):values[name]=control(prefix+'_'+name)
        hand_controls[side]=values
    by_name={o.name:o for o in parts};cover=by_name['feed_cover'];charging=by_name['charging_handle'];bolt=by_name['bolt'];trigger=by_name['trigger'];pouch=by_name['pouch'];spare=by_name['pouch_spare']
    all_parts=parts+controls+[belt]
    for o in parts:o.rotation_mode='QUATERNION'
    rest={o.name:(o.location.copy(),o.rotation_quaternion.copy()) for o in parts}
    def key(o,time,loc=(0,0,0),rot=(0,0,0),scale=1):
        o.location=rest[o.name][0]+xyz(loc);o.rotation_quaternion=rest[o.name][1]@quat(eq(tuple(math.radians(a) for a in rot)));o.scale=(scale,)*3
        for prop in ('location','rotation_quaternion','scale'):o.keyframe_insert(prop,frame=time*FPS,group=o.name)
    def pose(side,time,pos=None,q=None,p=None):
        data=ref['sides'][side];cs=hand_controls[side];f=time*FPS
        pos=pos if pos is not None else ref['grips'][side]['pos'];q=q if q is not None else Quaternion((data['quaternion'][3],*data['quaternion'][:3]));p=p if p is not None else data['grip']
        wrist=cs['wrist'];wrist.location=xyz(pos);wrist.rotation_quaternion=quat(q)
        wrist.keyframe_insert('location',frame=f);wrist.keyframe_insert('rotation_quaternion',frame=f)
        for i in range(4):
            o=cs[f'finger_{i}_root'];o.rotation_quaternion=quat(eq((0,p['fingerSpread'][i],0)));o.keyframe_insert('rotation_quaternion',frame=f)
            for j in range(3):
                o=cs[f'finger_{i}_{j}'];o.rotation_quaternion=quat(eq((-p['fingers'][i][j],0,0)));o.keyframe_insert('rotation_quaternion',frame=f)
        o=cs['thumb_base'];o.rotation_quaternion=quat(eq(p['thumbBase']));o.rotation_quaternion.make_compatible(quat(eq(data['grip']['thumbBase'])));o.keyframe_insert('rotation_quaternion',frame=f)
        for j in range(2):
            o=cs[f'thumb_{j}'];o.rotation_quaternion=quat(eq((-p['thumb'][j],0,0)));o.keyframe_insert('rotation_quaternion',frame=f)
    def bone_pose(time,phase=0,load=1):
        for i,pb in enumerate(belt.pose.bones):
            delta=xyz(Vector(belt_pos(i-phase))-Vector(belt_pos(i)))
            pb.location=pb.bone.matrix_local.to_3x3().inverted()@delta
            before=Vector(belt_pos(i+.01))-Vector(belt_pos(i));after=Vector(belt_pos(i-phase+.01))-Vector(belt_pos(i-phase))
            angle=math.atan2(after.y,after.x)-math.atan2(before.y,before.x)
            basis=pb.bone.matrix_local.to_3x3();pb.rotation_mode='QUATERNION'
            pb.rotation_quaternion=(basis.inverted()@C@Matrix.Rotation(angle,3,'Z')@CI@basis).to_quaternion()
            pb.scale=(load,)*3
            for prop in ('location','rotation_quaternion','scale'):pb.keyframe_insert(prop,frame=time*FPS,group=pb.name)
    def begin(name,duration):
        clips[name]={'frames':[0,duration*FPS],'duration':duration,'events':[]}
        for o in all_parts:
            o.animation_data_create();o.animation_data.action=None
            for t in o.animation_data.nla_tracks:t.mute=True
            o.animation_data.action=bpy.data.actions.new(name+' | '+o.name)
        for o in parts:
            key(o,0,scale=0 if o==spare else 1);key(o,duration,scale=0 if o==spare else 1)
        for side in ('left','right'):pose(side,0);pose(side,duration)
        bone_pose(0);bone_pose(duration)
    def finish(name):
        for o in all_parts:
            ad=o.animation_data;a=ad.action
            for layer in a.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for point in curve.keyframe_points:
                                point.interpolation='CONSTANT' if curve.data_path.endswith('scale') else 'BEZIER'
                                point.handle_left_type='AUTO_CLAMPED';point.handle_right_type='AUTO_CLAMPED'
            t=ad.nla_tracks.new();t.name=name;st=t.strips.new(name,0,a);st.action_frame_start=0;st.action_frame_end=math.ceil(clips[name]['frames'][1]);st.extrapolation='HOLD';st.blend_type='REPLACE';ad.action=None;t.mute=True
    def relaxed(side):
        p=copy.deepcopy(ref['sides'][side]['grip']);p['fingers']=[[.15,.25,.18],[.20,.30,.20],[.25,.32,.24],[.32,.36,.27]];p['thumb']=[.12,.20];return p
    def indexed():
        p=copy.deepcopy(ref['sides']['right']['grip']);p['fingers'][0]=[-.05,.10,.15];p['fingerSpread'][0]=.22;return p
    def contact(name,time,pos=None):
        data=ref[name];pose('left',time,pos or data['pos'],Quaternion((data['quaternion'][3],*data['quaternion'][:3])),data['pose'])
    begin('Idle',0);key(bolt,0,(0,0,.050));finish('Idle')  # single rest pose
    duration=60/700
    for name in ('Fire','Last_Shot'):
        begin(name,duration)
        # One positive feed advance; no belt jitter driven by frame RNG.
        for t,z in [(0,.050),(.014,0),(.042,.058),(.068,.050),(duration,.050)]:key(bolt,t,(0,0,z))
        for t,a in [(0,0),(.010,-10),(.040,-10),(.075,0)]:key(trigger,t,rot=(a,0,0))
        bone_pose(0,0);bone_pose(.008,0);bone_pose(.050,1);bone_pose(duration,1)
        p=copy.deepcopy(ref['sides']['right']['grip']);p['fingers'][0]=[a+.03 for a in p['fingers'][0]]
        pose('right',.010,p=p);pose('right',.040,p=p);pose('right',duration)
        clips[name]['events']=[{'time':.014,'event':'review_ignition'},{'time':.042,'event':'review_feed'}];finish(name)
    for name,d,empty in [('Reload_Tactical',3.4,False),('Reload_Empty',4.8,True)]:
        begin(name,d)
        # Both reloads open the SIDE cover, replace the pouch, seat the short
        # starter belt and close the cover; only empty reload racks the handle.
        # Push the whole gun/hand rig forward before rolling the feed side up.
        # The old +25 mm pullback swung the buttpad into the player's head.
        for k,loc,rot in [(.12,(.04,-.015,-.14),(-8,8,18)),(.70,(.04,-.015,-.14),(-8,8,18)),(.95,(0,0,0),(0,0,0))]:key(rig,k*d,loc,rot)
        out=.28;insert=.70
        for k,a in [(0,0),(.16,0),(.23,-100),(.66,-100),(.77,0),(1,0)]:key(cover,k*d,rot=(0,a,0))
        for k,loc,s in [(0,(0,0,0),1),(.25,(0,0,0),1),(.28,(-.04,-.035,0),1),(.38,(-.08,-.25,.06),0),(.995,(0,0,0),0),(1,(0,0,0),1)]:key(pouch,k*d,loc,scale=s)
        for k,loc,s in [(0,(-.08,-.25,.06),0),(.40,(-.08,-.25,.06),1),(.49,(-.045,-.12,.02),1),(.57,(0,0,0),1),(.995,(0,0,0),1),(1,(0,0,0),0)]:key(spare,k*d,loc,scale=s)
        for k,load in [(0,0 if empty else 1),(.23,0),(.69,0),(.70,1),(1,1)]:bone_pose(k*d,load=load)
        for k in (.08,.40,.75,.94):pose('right',k*d,p=indexed())
        pose('left',.08*d,[-.10,.035,-.230],p=relaxed('left'))
        contact('feed',.16*d);contact('feed',.23*d,[-.15,.083,-.19])
        pose('left',.245*d,[-.175,-.06,-.12],p=relaxed('left'))
        contact('pouch',.265*d,[-.17,-.215,-.10])
        removed=Vector(ref['pouch']['pos'])+Vector((-.08,-.25,.06))
        contact('pouch',.28*d);contact('pouch',.38*d,removed);contact('pouch',.40*d,removed);contact('pouch',.57*d)
        # Retract outboard before lifting from the pouch to the feed mouth;
        # a direct interpolated lift sweeps the sleeve through the pouch.
        pose('left',.595*d,[-.165,-.14,-.12],p=relaxed('left'))
        pose('left',.62*d,[-.175,.035,-.13],p=relaxed('left'))
        # Follow the evaluated pouch path at authoring frequency, not merely
        # an endpoint interpolation that lets the glove detach mid-stroke.
        for first,last,part in [(.27,.375,pouch),(.40,.57,spare)]:
            for f in range(math.ceil(first*d*FPS),math.floor(last*d*FPS)+1):
                scene.frame_set(f);pm=Matrix.LocRotScale(part.location,part.rotation_quaternion,Vector((1,1,1)))
                gm=CI.to_4x4()@pm@C.to_4x4();contact('pouch',f/FPS,gm@Vector(ref['pouch']['pos']))
        contact('feed',.64*d);contact('feed',.70*d);contact('feed',.77*d,[-.145,.095,-.16])
        if empty:
            for k,z in [(0,.050),(.80,.050),(.88,.065),(.93,.050),(1,.050)]:key(bolt,k*d,(0,0,z))
            for k,z in [(0,0),(.82,0),(.88,.065),(.93,0),(1,0)]:key(charging,k*d,(0,0,z))
            # Carry the released hand behind the optic, palm vertical and
            # fingers down, instead of stretching above the sight/shoulder line.
            passage=Quaternion((0,0,math.sqrt(.5),math.sqrt(.5)))
            pose('left',.785*d,[-.20,.02,.14],q=passage,p=relaxed('left'))
            pose('left',.805*d,[.20,.02,.14],q=passage,p=relaxed('left'))
            contact('charging',.82*d);contact('charging',.88*d,[.123,.135,-.003])
            pose('left',.91*d,[.20,.02,.14],q=passage,p=relaxed('left'))
            pose('left',.94*d,[-.20,.02,.14],q=passage,p=relaxed('left'))
            pose('left',.97*d,[-.24,.022,-.35],q=passage,p=relaxed('left'))
        else:
            key(bolt,0,(0,0,.050));key(bolt,d,(0,0,.050))
            # Retract fully outboard before returning alongside a long optic.
            pose('left',.81*d,[-.24,.095,-.16],p=relaxed('left'))
            pose('left',.90*d,[-.24,.085,-.35],p=relaxed('left'))
        pose('left',.985*d)
        clips[name]['beltClearTime']=.23*d;clips[name]['beltInsertTime']=insert*d
        clips[name]['events']=[{'time':.02*d,'event':'start'},{'time':out*d,'event':'magout'},{'time':insert*d,'event':'magin'}]
        if empty:clips[name]['events'] += [{'time':.88*d,'event':'charge'},{'time':.93*d,'event':'boltrelease'}]
        clips[name]['events'].append({'time':.995*d,'event':'end'});finish(name)
        if empty:
            action=next(t for t in hand_controls['left']['wrist'].animation_data.nla_tracks if t.name==name).strips[0].action
            reference,expected=charging_contact_reference(action,d)
            curve=next(c for layer in action.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves if c.data_path=='location' and c.array_index==1)
            start=min(curve.keyframe_points,key=lambda p:abs(p.co.x-.82*d*FPS))
            end=min(curve.keyframe_points,key=lambda p:abs(p.co.x-.88*d*FPS))
            start.handle_right_type='FREE';start.handle_right=expected.keyframe_points[2].handle_right
            end.handle_left_type='FREE';end.handle_left=expected.keyframe_points[3].handle_left
            curve.update();bpy.data.actions.remove(reference)

    begin('Inspect',3.6)
    for t,loc,rot in [(.45,(-.02,.065,-.12),(-10,-40,12)),(1.20,(-.02,.065,-.12),(-10,-40,12)),(1.95,(-.03,.06,-.13),(6,40,-12)),(2.75,(-.03,.06,-.13),(6,40,-12)),(3.45,(0,0,0),(0,0,0))]:key(rig,t,loc,rot)
    for t in (.2,.9,1.8,3.2):pose('right',t,p=indexed())
    for t,pos in [(.35,[-.16,-.10,-.23]),(.8,[-.17,-.17,-.17]),(2.9,[-.17,-.17,-.17]),(3.1,[-.17,.055,-.30]),(3.45,ref['grips']['left']['pos'])]:pose('left',t,pos,p=relaxed('left') if t<3.4 else None)
    key(bolt,0,(0,0,.050));key(bolt,3.6,(0,0,.050));clips['Inspect']['events']=[{'time':3.582,'event':'end'}];finish('Inspect')
    for name,d,drawing in [('Draw',.75,True),('Holster',.5,False)]:
        begin(name,d)
        for k,a in ([(0,1),(.25,.78),(.78,.04),(.93,0),(1,0)] if drawing else [(0,0),(.2,.08),(.75,.8),(1,1)]):
            key(rig,k*d,(.025*a,-.15*a,.24*a),(-22*a,20*a,12*a));pos=Vector(ref['grips']['left']['pos'])+Vector((-.05*a,-.055*a,.035*a))
            pose('left',k*d,pos,p=relaxed('left') if a>.2 else None);pose('right',k*d,p=indexed() if a>.2 else None)
        key(bolt,0,(0,0,.050));key(bolt,d,(0,0,.050));clips[name]['events']=[{'time':.995*d,'event':'end'}];finish(name)
    # Shared review skins are baked from these controls, never exported.
    author_review_hands(root,rig,hand_controls,all_parts,clips,basis=C,label='EVOLYS')
    return clips
