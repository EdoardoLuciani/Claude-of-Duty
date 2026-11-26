"""M590 Blender weapon/wrist/finger authoring; shared skins appended for DCC review.
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

def author_actions(root,asset,rig,parts,forend,bolt,trigger,shell):
    ref=json.loads((root/'src/weapons/authored/m590/hand-reference.json').read_text())
    stroke=ref['pump']['stroke'][2]
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
    rest={o.name:(o.location.copy(),o.rotation_quaternion.copy()) for o in all_parts};clips={}
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
        for o in all_parts:
            scale=0 if o==shell else 1
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
                                point.interpolation='CONSTANT' if curve.data_path=='scale' else 'LINEAR'
                                point.handle_left_type='AUTO_CLAMPED';point.handle_right_type='AUTO_CLAMPED'
            t=ad.nla_tracks.new();t.name=name;st=t.strips.new(name,0,a);st.action_frame_start=0;st.action_frame_end=math.ceil(clips[name]['frames'][1]);st.extrapolation='HOLD';st.blend_type='REPLACE';ad.action=None;t.mute=True
    def smooth(a):return a*a*(3-2*a)
    def path(t,keys):
        if t<=keys[0][0]:return keys[0][1]
        for (a,v),(b,w) in zip(keys,keys[1:]):
            if t<=b:
                u=smooth((t-a)/(b-a));return tuple(v[i]+(w[i]-v[i])*u for i in range(len(v)))
        return keys[-1][1]
    def samples(d,beats=()):return sorted(set([min(f/FPS,d) for f in range(math.ceil(d*FPS)+1)]+list(beats)))
    def blend_pose(a,b,u):
        p=copy.deepcopy(b)
        for field in ('fingers','thumb','thumbBase','fingerSpread'):
            if field=='fingers':p[field]=[[x+(y-x)*u for x,y in zip(xx,yy)] for xx,yy in zip(a[field],b[field])]
            else:p[field]=[x+(y-x)*u for x,y in zip(a[field],b[field])]
        return p
    def events(name,d,beats):clips[name]['events']=[{'time':fraction*d,'event':event} for fraction,event in beats]
    def follow_forend(t,z):
        key(forend,t,(0,0,z));key(bolt,t,(0,0,z))
        pose('left',t,Vector(ref['grips']['left']['pos'])+Vector((0,0,z)))
    begin('Idle',0);finish('Idle')  # single rest pose
    d=.45;begin('Pump',d)
    for t in samples(d,[.32*d,.55*d,.82*d]):
        z=path(t/d,[(0,(0,)),(.32,(stroke,)),(.55,(stroke,)),(.82,(0,)),(1,(0,))])[0]
        follow_forend(t,z)
    for t,a in [(0,0),(.010,-.28),(.030,-.28),(.060,0),(d,0)]:key(trigger,t,rot=(math.degrees(a),0,0))
    p=copy.deepcopy(ref['sides']['right']['grip']);p['fingers'][0]=[v+.035 for v in p['fingers'][0]]
    pose('right',.010,p=p);pose('right',.030,p=p);pose('right',.060)
    # Handling tilt only; recoil remains reactive in the viewmodel.
    key(rig,.28*d,(.006,-.010,.016),(-4.58,2.29,3.44));key(rig,.62*d,(.004,-.006,.010),(-1.72,1.15,1.72))
    # Contact cues at the authored rear/forward stops; pump still owns ejection.
    events('Pump',d,[(.32,'pump'),(.82,'boltrelease'),(.995,'end')]);finish('Pump')
    sh=ref['shell'];sq=Quaternion((sh['quaternion'][3],*sh['quaternion'][:3]));relative=Vector(sh['pos'])-Vector(sh['hullPosition'])
    insertion=ref['insertion'];iq=Quaternion((insertion['quaternion'][3],*insertion['quaternion'][:3]))
    insert_relative=Vector(insertion['pos'])-Vector(sh['hullPosition'])
    withdrawn=copy.deepcopy(insertion['pose']);withdrawn['thumb']=[.95,1.0]
    for name,d,empty_reload in [('Reload_Tactical',.55,False),('Reload_Empty',.95,True)]:
        begin(name,d)
        appear=.44 if empty_reload else .34;accept=.68 if empty_reload else .82;hide=.70 if empty_reload else .84
        release_start=.50 if empty_reload else .58;release_end=.58 if empty_reload else .70
        raised=.58 if empty_reload else .72
        shell_keys=[(appear,(.030,-.140,.010,60)),(release_start,(0,-.065,-.043,60)),(raised,(0,-.006,-.049,60)),(accept,(0,.0348,-.068,0)),(hide,(0,.0348,-.068,0))]
        start_pos=Vector(shell_keys[0][1][:3]);start_q=eq((math.pi/3,0,0));contact_pos=start_pos+start_q@relative
        wrist_keys=[(.22 if empty_reload else 0,tuple(Vector(ref['grips']['left']['pos'])+Vector((0,0,stroke if empty_reload else 0)))),(.34 if empty_reload else .16,(-.09,-.08,-.10)),(appear,tuple(contact_pos))]
        for t in samples(d,[appear*d,release_start*d,release_end*d,raised*d,accept*d,hide*d]):
            u=t/d;x,y,z,angle=path(u,shell_keys);hq=eq((math.radians(angle),0,0))
            key(shell,t,(x,y,z),(angle,0,0),scale=1 if appear<=u<hide else 0)
            if appear<=u<=hide:
                blend=smooth(min(1,max(0,(u-release_start)/(release_end-release_start))))
                offset=relative.lerp(insert_relative,blend)
                p=blend_pose(sh['pose'],insertion['pose'],blend)
                wrist_pos=Vector((x,y,z))+hq@offset
                if u>accept:
                    p=blend_pose(p,withdrawn,smooth(min(1,(u-accept)/.065)))
                    retreat=smooth(min(1,(u-accept)/(hide-accept)))
                    wrist_pos+=Vector((-.010,-.014,0))*retreat
                pose('left',t,wrist_pos,hq@sq.slerp(iq,blend),p)
            elif u<appear:
                if empty_reload and u<=.22:
                    pull=path(u,[(0,(0,)),(.22,(stroke,))])[0];follow_forend(t,pull)
                else:
                    depart=.22 if empty_reload else 0
                    blend=smooth(min(1,max(0,(u-depart)/(appear-depart-.04))))
                    gq=Quaternion((ref['sides']['left']['quaternion'][3],*ref['sides']['left']['quaternion'][:3]))
                    pose('left',t,path(u,wrist_keys),gq.slerp(start_q@sq,blend),blend_pose(ref['sides']['left']['grip'],sh['pose'],blend))
            else:
                # Release without dragging the accepted hull back out.
                release=Vector((0,.0348,-.068))+insert_relative+Vector((-.010,-.014,0))
                end=.78 if empty_reload else 1
                target=Vector(ref['grips']['left']['pos'])+Vector((0,0,stroke if empty_reload else 0))
                v=min(1,max(0,(u-hide)/(end-hide)))
                # A continuous outboard arc clears the larger factory receiver
                # without two stop/start segments or a late wrist snap.
                pos=release.lerp(target,v);pos.x-=.065*math.sin(math.pi*v)
                # Stay below the loading lip until the glove is outboard and
                # forward of the receiver nose, then rise onto the rail.
                pos.y=release.y+(target.y-release.y)*smooth(max(0,(v-.4)/.6))
                blend=smooth(v)
                retract=smooth(min(1,max(0,(u-accept)/.065)))
                p=blend_pose(blend_pose(insertion['pose'],withdrawn,retract),ref['sides']['left']['grip'],blend)
                gq=Quaternion((ref['sides']['left']['quaternion'][3],*ref['sides']['left']['quaternion'][:3]))
                pose('left',t,pos,iq.slerp(gq,blend),p)
            if empty_reload:
                pull=path(u,[(0,(0,)),(.22,(stroke,)),(.88,(stroke,)),(.94,(0,)),(1,(0,))])[0]
                key(forend,t,(0,0,pull));key(bolt,t,(0,0,pull))
                if u>=.78:pose('left',t,Vector(ref['grips']['left']['pos'])+Vector((0,0,pull)))
        # Complete reset channels and original fractional gameplay times.
        key(shell,d,scale=0);pose('left',d)
        for k,loc,rot in [(.18,(.010,-.018,.020),(-5.73,12.61,16.04)),(.55,(.012,-.020,.018),(-4.58,14.90,18.33)),(1,(0,0,0),(0,0,0))]:key(rig,k*d,loc,rot)
        # Empty reload opens BEFORE shell insertion, not at the return onset.
        events(name,d,[(.02,'start')]+([(.22,'pump')] if empty_reload else [])+[(accept,'shellin')]+([(.94,'boltrelease')] if empty_reload else [])+[(.995,'end')])
        finish(name)
    # Move the gun as a unit; the support hand stays on the seated pump.
    d=4.8;begin('Inspect',d)
    turn=[
        (0,(0,0,0,0,0,0)),
        (.10,(.018,.035,-.066,9,20,1)),
        (.22,(.026,.068,-.128,10,49,4)),
        (.36,(.021,.064,-.132,8,47,6)),
        (.48,(.001,.027,-.151,12,49,32)),
        (.62,(-.033,.052,-.179,22,51,91)),
        (.78,(-.026,.060,-.170,20,48,85)),
        (.90,(.007,.031,-.075,10,23,30)),
        (.98,(0,0,0,0,0,0)),
    ]
    for t in samples(d):
        v=path(t/d,turn);key(rig,t,v[:3],v[3:])
    events('Inspect',d,[(.995,'end')]);finish('Inspect')
    for name,d,drawing in [('Draw',.7,True),('Holster',.45,False)]:
        begin(name,d)
        for k,amount in ([(0,1),(.25,.78),(.78,.04),(.93,0),(1,0)] if drawing else [(0,0),(.2,.08),(.75,.8),(1,1)]):
            key(rig,k*d,(.025*amount,-.13*amount,.24*amount),(-22*amount,20*amount,12*amount))
        events(name,d,[(.995,'end')]);finish(name)
    # Shared review skins are baked from these controls, never exported.
    author_review_hands(root,rig,hand_controls,all_parts,clips,basis=C,label='M590')
    return clips,controls
