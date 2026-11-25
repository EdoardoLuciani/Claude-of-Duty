"""M4 Blender weapon/wrist/finger authoring; shared skins appended for DCC review.
Game recoil stays in its existing reactive layer, not a duplicate baked kick.
"""
import copy
import json
import math
import bpy
from mathutils import Vector, Quaternion, Matrix
from review_hands import author_review_hands, eq

C=Matrix(((1,0,0),(0,0,-1),(0,1,0)));CI=C.inverted();FPS=120
def xyz(v):return C@Vector(v)
def quat(q):return (C@q.to_matrix()@CI).to_quaternion()

def author_actions(root,asset,rig,parts,mag,spare,bolt,head,handle,trigger,cover,release,case):
    scene=bpy.context.scene
    ref=json.loads((root/'src/weapons/authored/m4a1-block-ii/hand-reference.json').read_text())
    controls=[];hand_controls={}
    def control(name):
        o=bpy.data.objects.new(name,None);asset.objects.link(o);o.parent=rig;o.rotation_mode='QUATERNION';o.empty_display_size=.004;controls.append(o);return o
    for side,prefix in [('left','L'),('right','R')]:
        values={'wrist':control('hand_'+prefix)}
        for i in range(4):
            values[f'finger_{i}_root']=control(f'{prefix}_finger_{i}_root')
            for j in range(3):values[f'finger_{i}_{j}']=control(f'{prefix}_finger_{i}_{j}')
        for name in ('thumb_base','thumb_0','thumb_1'):values[name]=control(prefix+'_'+name)
        hand_controls[side]=values
    all_parts=parts+controls
    for o in parts:o.rotation_mode='QUATERNION'
    rest={o.name:(o.location.copy(),o.rotation_quaternion.copy()) for o in parts};clips={}
    def key(o,time,loc=(0,0,0),rot=(0,0,0),scale=1):
        o.location=rest[o.name][0]+xyz(loc);o.rotation_quaternion=rest[o.name][1]@quat(eq(tuple(math.radians(a) for a in rot)));o.scale=(scale,)*3
        for prop in ('location','rotation_quaternion','scale'):o.keyframe_insert(prop,frame=time*FPS,group=o.name)
    def pose(side,time,pos=None,q=None,p=None):
        data=ref['sides'][side];cs=hand_controls[side];f=time*FPS
        pos=pos if pos is not None else ref['grips'][side]['pos']
        q=q if q is not None else Quaternion((data['quaternion'][3],*data['quaternion'][:3]));p=p if p is not None else data['grip']
        wrist=cs['wrist'];wrist.location=xyz(pos);wrist.rotation_quaternion=quat(q)
        wrist.keyframe_insert('location',frame=f);wrist.keyframe_insert('rotation_quaternion',frame=f)
        for i in range(4):
            o=cs[f'finger_{i}_root'];o.rotation_quaternion=quat(eq((0,p['fingerSpread'][i],0)));o.keyframe_insert('rotation_quaternion',frame=f)
            for j in range(3):
                o=cs[f'finger_{i}_{j}'];o.rotation_quaternion=quat(eq((-p['fingers'][i][j],0,0)));o.keyframe_insert('rotation_quaternion',frame=f)
        o=cs['thumb_base'];o.rotation_quaternion=quat(eq(p['thumbBase']));o.rotation_quaternion.make_compatible(quat(eq(data['grip']['thumbBase'])));o.keyframe_insert('rotation_quaternion',frame=f)
        for j in range(2):
            o=cs[f'thumb_{j}'];o.rotation_quaternion=quat(eq((-p['thumb'][j],0,0)));o.keyframe_insert('rotation_quaternion',frame=f)
    def begin(name,duration):
        clips[name]={'frames':[0,duration*FPS],'duration':duration,'events':[]}
        for o in all_parts:
            o.animation_data_create();o.animation_data.action=None
            for t in o.animation_data.nla_tracks:t.mute=True
            o.animation_data.action=bpy.data.actions.new(name+' | '+o.name)
        for o in parts:
            scale=0 if o in (spare,case) else 1
            key(o,0,scale=scale);key(o,duration,scale=scale)
        for side in ('left','right'):pose(side,0);pose(side,duration)
    def finish(name):
        for o in all_parts:
            ad=o.animation_data;a=ad.action
            for layer in a.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for point in curve.keyframe_points:
                                point.interpolation='CONSTANT' if curve.data_path=='scale' else 'BEZIER'
                                point.handle_left_type='AUTO_CLAMPED';point.handle_right_type='AUTO_CLAMPED'
            t=ad.nla_tracks.new();t.name=name;st=t.strips.new(name,0,a);st.action_frame_start=0;st.action_frame_end=math.ceil(clips[name]['frames'][1]);st.extrapolation='HOLD';st.blend_type='REPLACE';ad.action=None;t.mute=True
    def relaxed(side):
        p=copy.deepcopy(ref['sides'][side]['grip']);p['fingers']=[[.15,.25,.18],[.20,.30,.20],[.25,.32,.24],[.32,.36,.27]];p['thumb']=[.12,.20];return p
    def indexed():
        p=copy.deepcopy(ref['sides']['right']['grip']);p['fingers'][0]=[-.05,.10,.15];p['fingerSpread'][0]=.22;return p
    begin('Idle',0);finish('Idle')  # single rest pose
    for name,locked in [('Fire',False),('Last_Shot',True)]:
        begin(name,.075)
        # Existing reactive viewmodel/camera recoil remains unchanged. Blender
        # authors the mechanism and trigger finger, not another root impulse.
        for t,z in [(0,0),(.021,.062),(.035,.052),(.0465,.062 if locked else 0),(.075,.062 if locked else 0)]:key(bolt,t,(0,0,z))
        for t,a in [(0,0),(.006,22.5),(.035,22.5),(.0465,22.5 if locked else 0),(.075,22.5 if locked else 0)]:key(head,t,rot=(0,0,a))
        for t,a in [(0,0),(.010,-12),(.026,-12),(.0465,0)]:key(trigger,t,rot=(a,0,0))
        key(cover,0,rot=(0,0,0));key(cover,.018,rot=(0,0,-115));key(cover,.075,rot=(0,0,-115))
        p=copy.deepcopy(ref['sides']['right']['grip']);p['fingers'][0]=[a+.035 for a in p['fingers'][0]]
        pose('right',.008,p=p);pose('right',.027,p=p);pose('right',.047)
        key(case,.03375,(.023,.081,-.052),scale=1);key(case,.066,(.16,.12,-.015),rot=(95,25,65));key(case,.075,scale=0)
        clips[name]['events']=[{'time':.03375,'event':'review_casing_eject'}]
        finish(name)
    # Exact gameplay event times, independent of rounded video/sampler frames.
    for name,d,empty_reload in [('Reload_Tactical',2.1,False),('Reload_Empty',2.9,True)]:
        begin(name,d)
        out=.16 if empty_reload else .20;drop=.30 if empty_reload else .34;insert=.71 if empty_reload else .81
        for k,loc,rot in [(.10,(.012,-.024,.02),(-8,16,23)),(.44,(.016,-.030,.026),(-7,20,28)),(.70,(.012,-.022,.022),(-7,16,25)),(.95,(0,0,0),(0,0,0))]:key(rig,k*d,loc,rot)
        for k,loc,s in [(0,(0,0,0),1),(out-.025,(0,0,0),1),(out,(0,-.033,0),1),(drop-.02,(.01,-.20,.04),1),(drop,(.02,-.32,.06),0),(1,(0,0,0),1)]:key(mag,k*d,loc,scale=s)
        appear=drop+.045
        for k,loc,s in [(0,(.02,-.32,.06),0),(appear,(.02,-.31,.05),1),(insert-.14,(.01,-.15,.02),1),(insert-.045,(0,-.035,0),1),(insert,(0,0,0),1),(.999,(0,0,0),1),(1,(0,0,0),0)]:key(spare,k*d,loc,scale=s)
        for k in (.06,.35,.60,.94):pose('right',k*d,p=indexed())
        pose('right',(out-.05)*d,p=ref['sides']['right']['release']);pose('right',(out+.01)*d,p=ref['sides']['right']['release'])
        key(release,(out-.05)*d);key(release,(out-.015)*d,(-.0012,0,0));key(release,(out+.02)*d,(-.0012,0,0));key(release,(out+.07)*d)
        mq=Quaternion((ref['magazine']['quaternion'][3],*ref['magazine']['quaternion'][:3]));mp=ref['magazine']['pose']
        pose('left',.055*d,[-.085,.02,-.14],p=relaxed('left'))
        pose('left',(out-.04)*d,ref['magazine']['pos'],mq,mp)
        pose('left',drop*d,[-.07,-.44,.05],mq,relaxed('left'))
        pose('left',appear*d,[-.07,-.42,.04],mq,mp)
        pose('left',(insert+.03)*d,ref['magazine']['pos'],mq,mp)
        pose('left',(insert+.065)*d,[-.065,-.13,-.08],p=relaxed('left'))
        for first,last,part in [(out-.04,drop-.015,mag),(appear,insert+.03,spare)]:
            for f in range(math.ceil(first*d*FPS),math.floor(last*d*FPS)+1):
                scene.frame_set(f);pm=Matrix.LocRotScale(part.location,part.rotation_quaternion,Vector((1,1,1)));gm=CI.to_4x4()@pm@C.to_4x4()
                pose('left',f/FPS,gm@Vector(ref['magazine']['pos']),gm.to_quaternion()@mq,mp)
        if empty_reload:
            # Charging handle and carrier share the original release beats.
            for k,z in [(0,.062),(.90,.062),(.917,0),(1,0)]:key(bolt,k*d,(0,0,z))
            for k,a in [(0,22.5),(.90,22.5),(.917,0),(1,0)]:key(head,k*d,rot=(0,0,a))
            for k,z in [(0,0),(.86,0),(.90,.082),(.917,0),(1,0)]:key(handle,k*d,(0,0,z))
            charging=ref['charging'];cq=Quaternion((charging['quaternion'][3],*charging['quaternion'][:3]))
            cp=charging['pose'];wrist=Vector(charging['pos'])
            # Free approach/return stay outboard of rail-mounted sights; evenly
            # spaced keys hold the hand below about 2.5 m/s.
            pose('left',.80*d,[-.18,-.06,.035],cq,cp)
            pose('left',.83*d,[-.18,.14,.035],cq,cp)
            pose('left',.845*d,[-.15,.14,wrist.z],cq,cp)
            pose('left',.86*d,wrist,cq,cp)
            # Follow the evaluated handle stroke, not a reused magazine grip.
            for f in range(math.ceil(.86*d*FPS),math.floor(.90*d*FPS)+1):
                scene.frame_set(f);pose('left',f/FPS,wrist+CI@handle.location,cq,cp)
            pose('left',.90*d,wrist+Vector((0,0,.082)),cq,cp)
            pose('left',.917*d,[-.18,.15,wrist.z+.082],cq,cp)
            pose('left',.935*d,[-.18,.13,.04],cq,cp)
            pose('left',.96*d,[-.18,.06,-.12],cq,relaxed('left'))
        pose('left',.98*d)
        for k in (0,1):key(cover,k*d,rot=(0,0,-115))
        clips[name]['events']=[{'time':.02*d,'event':'start'},{'time':out*d,'event':'magout'},{'time':drop*d,'event':'magdrop'},{'time':insert*d,'event':'magin'}]
        clips[name]['events'] += ([{'time':.90*d,'event':'charge'},{'time':.917*d,'event':'boltrelease'}] if empty_reload else [{'time':.88*d,'event':'slap'}])
        clips[name]['events'].append({'time':.995*d,'event':'end'});finish(name)
    # CS2 M4A4 motion reference: see the M4A1 authoring README.
    inspect_end=6
    begin('Inspect',inspect_end)
    for t,loc,rot in [
        (.10,(.014,-.009,.012),(-3,0,2)),
        (.29,(.030,.035,-.035),(19,9,-4)),
        (.46,(.044,.068,-.093),(18,31,9)),
        (.68,(.050,.080,-.120),(9,58,10)),
        (.92,(.047,.079,-.109),(7,55,6)),
        (2.85,(.023,.062,-.145),(6,64,7)),
        (3.65,(.007,.057,-.146),(6,68,11)),
        (4.10,(-.012,.026,-.120),(14,59,22)),
        (4.55,(-.015,.004,-.072),(20,44,38)),
        (4.89,(.002,.031,-.061),(26,30,20)),
        (5.16,(-.006,.016,-.029),(13,18,6)),
        (5.48,(.005,-.008,.006),(-3,2,-2)),
        (5.83,(0,0,0),(0,0,0)),
    ]:key(rig,t,loc,rot)

    # Keep the trigger opening clear and wrap the visible side of the A2 grip.
    wrist=(.03540,-.01545,.14810)
    wrist_rotation=Quaternion((.724537,-.036740,-.017803,-.688025))
    grip={
        'fingerSpread':[-.135,-.030,.022,-.168],
        'fingers':[[-.242,1.322,.357],[.131,1.687,.946],[.388,1.660,.833],[.498,1.571,.804]],
        'thumbBase':[-1.181,-.614,-2.643],
        'thumb':[.015,1.087],
    }
    for t in (.18,5.52):pose('right',t,wrist,wrist_rotation,grip)

    # Peel off the rail before opening the fingers, then park the hand in
    # ready space so it doesn't orbit with the receiver during the reveal.
    loose=relaxed('left')
    pose('left',.10,(-.083,.035,-.192))
    pose('left',.18,(-.127,.010,-.191))
    pose('left',.28,(-.167,-.055,-.185),p=loose)
    x,y,z,w=ref['sides']['left']['quaternion'];lq=Quaternion((w,x,y,z))
    for t,pos in [
        (.40,(-.194,-.200,-.170)),
        *((t,(-.225,-.284,-.133)) for t in (.68,.92,2.85,3.65,3.95)),
        (4.17,(-.222,-.217,-.155)),
    ]:
        f=round(t*FPS,6)
        scene.frame_set(math.floor(f),subframe=f%1)
        ready_to_rig=CI.to_4x4()@rig.matrix_basis.inverted()@C.to_4x4()
        pose('left',t,ready_to_rig@Vector(pos),ready_to_rig.to_quaternion()@lq,loose)
    pose('left',4.38,(-.156,-.024,-.204),p=loose)
    pose('left',4.61,(-.120,.006,-.204),p=loose)
    pose('left',4.77,(-.089,.032,-.196))
    pose('left',4.92)
    clips['Inspect']['events']=[{'time':inspect_end-.025,'event':'end'}];finish('Inspect')
    for name,d,drawing in [('Draw',.62,True),('Holster',.4,False)]:
        begin(name,d)
        for k,amount in ([(0,1),(.25,.78),(.78,.04),(.93,0),(1,0)] if drawing else [(0,0),(.20,.08),(.75,.8),(1,1)]):
            key(rig,k*d,(.025*amount,-.13*amount,.24*amount),(-22*amount,20*amount,12*amount))
            pos=Vector(ref['grips']['left']['pos'])+Vector((-.05*amount,-.055*amount,.035*amount));pose('left',k*d,pos,p=relaxed('left') if amount>.2 else None);pose('right',k*d,p=indexed() if amount>.2 else None)
        clips[name]['events']=[{'time':.995*d,'event':'end'}];finish(name)

    # Shared review skins are baked from these controls, never exported.
    hands=author_review_hands(root,rig,hand_controls,all_parts,clips,basis=C,label='M4')
    return clips,controls,hands
