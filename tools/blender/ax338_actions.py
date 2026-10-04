"""AX338 weapon/wrist/finger actions; shared runtime reactive layers remain."""
import copy
import json
import math
import bpy
from mathutils import Vector, Quaternion, Matrix

C=Matrix(((1,0,0),(0,0,-1),(0,1,0)));CI=C.inverted();FPS=120
def xyz(v):return C@Vector(v)
def quat(q):return (C@q.to_matrix()@CI).to_quaternion()
def eq(e):return Quaternion((1,0,0),e[0])@Quaternion((0,1,0),e[1])@Quaternion((0,0,1),e[2])

def author_actions(root,asset,rig,parts,mag,spare,bolt,trigger):
    scene=bpy.context.scene
    ref=json.loads((root/'assets/weapons/ax338/hand-reference.json').read_text())
    controls=[];hand_controls={};right_ranges=[]
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
    def pose(side,time,pos=None,q=None,p=None,holding_only=False,index_only=False):
        data=ref['sides'][side];cs=hand_controls[side];f=time*FPS
        pos=pos if pos is not None else ref['grips'][side]['pos']
        q=q if q is not None else Quaternion((data['quaternion'][3],*data['quaternion'][:3]));p=p if p is not None else data['grip']
        if not holding_only and not index_only:
            wrist=cs['wrist'];wrist.location=xyz(pos);wrist.rotation_quaternion=quat(q)
            wrist.keyframe_insert('location',frame=f);wrist.keyframe_insert('rotation_quaternion',frame=f)
        for i in range(4):
            if (holding_only and i==0) or (index_only and i!=0):continue
            o=cs[f'finger_{i}_root'];o.rotation_quaternion=quat(eq((0,p['fingerSpread'][i],p.get('fingerRoll',[0]*4)[i])));o.keyframe_insert('rotation_quaternion',frame=f)
            for j in range(3):
                o=cs[f'finger_{i}_{j}'];o.rotation_quaternion=quat(eq((-p['fingers'][i][j],0,0)));o.keyframe_insert('rotation_quaternion',frame=f)
        if index_only:return
        o=cs['thumb_base'];o.rotation_quaternion=quat(eq(p['thumbBase']));o.rotation_quaternion.make_compatible(quat(eq(data['grip']['thumbBase'])));o.keyframe_insert('rotation_quaternion',frame=f)
        for j in range(2):
            o=cs[f'thumb_{j}'];o.rotation_quaternion=quat(eq((-p['thumb'][j],0,0)));o.keyframe_insert('rotation_quaternion',frame=f)
    def begin(name,duration):
        right_ranges.clear()
        clips[name]={'frames':[0,duration*FPS],'duration':duration,'loop':name=='Idle','events':[]}
        for o in all_parts:
            o.animation_data_create();o.animation_data.action=None
            for t in o.animation_data.nla_tracks:t.mute=True
            o.animation_data.action=bpy.data.actions.new(name+' | '+o.name)
        for o in parts:
            scale=0 if o in (spare,) else 1
            key(o,0,scale=scale);key(o,duration,scale=scale)
        for side in ('left','right'):pose(side,0);pose(side,duration)
    def finish(name,contact_ranges=()):
        for o in all_parts:
            ad=o.animation_data;a=ad.action
            for layer in a.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for point in curve.keyframe_points:
                                # Dense skin-fitted contact spans are samples,
                                # not free Bezier tangents: easing their channels
                                # independently can overshoot the clearance solve.
                                fitted=((o.name=='hand_L' or o.name.startswith('L_')) and any(lo*FPS<=point.co.x<hi*FPS-.00001 for lo,hi in contact_ranges)) or ((o.name=='hand_R' or o.name.startswith('R_')) and any(lo*FPS<=point.co.x<hi*FPS-.00001 for lo,hi in right_ranges))
                                holding=o.name.startswith(('R_finger_1_','R_finger_2_','R_finger_3_'))
                                point.interpolation='CONSTANT' if curve.data_path=='scale' else ('LINEAR' if fitted or holding else 'BEZIER')
                                point.handle_left_type='AUTO_CLAMPED';point.handle_right_type='AUTO_CLAMPED'
            t=ad.nla_tracks.new();t.name=name;st=t.strips.new(name,0,a);st.action_frame_start=0;st.action_frame_end=math.ceil(clips[name]['frames'][1]);st.extrapolation='HOLD';st.blend_type='REPLACE';ad.action=None;t.mute=True
    def relaxed(side):
        p=copy.deepcopy(ref['sides'][side]['grip']);p['fingers']=[[.15,.25,.18],[.20,.30,.20],[.25,.32,.24],[.32,.36,.27]];p['thumb']=[.12,.20];return p
    def release_right(first,last,closing=False):
        right_ranges.append((first,last))
        for row in ref['rightRelease']:
            t=1-row['t'] if closing else row['t']
            pose('right',first+(last-first)*t,p=row['pose'],index_only=True)
    def grasp_right(first,last,closing=False):
        right_ranges.append((first,last))
        for row in ref['rightUnwrap']:
            t=1-row['t'] if closing else row['t']
            pose('right',first+(last-first)*t,p=row['pose'],holding_only=True)
    begin('Idle',2);finish('Idle')
    for name in ('Fire','Last_Shot'):
        begin(name,.12)
        # A manually operated rifle does not reciprocate its bolt on discharge.
        # Existing reactive recoil supplies the shot impulse.
        key(trigger,.012,rot=(-8,0,0));key(trigger,.055,rot=(-8,0,0));key(trigger,.10)
        p=copy.deepcopy(ref['sides']['right']['grip']);p['fingers'][0]=[a+.002 for a in p['fingers'][0]]
        pose('right',.012,p=p);pose('right',.055,p=p);pose('right',.10)
        finish(name)
    def follow_bolt(first,last):
        data=ref['bolt'];q=Quaternion((data['quaternion'][3],*data['quaternion'][:3]));wrist=Vector(data['pos'])
        # Normalize Blender's component-interpolated quaternion before composing
        # the rigid transform, matching the exported glTF/Three rotation. A raw
        # quaternion matrix otherwise moves contacts by several millimetres.
        # Native evaluated hinge/pull transforms include rotation around bore.
        rest_matrix=Matrix.LocRotScale(rest[bolt.name][0],rest[bolt.name][1],Vector((1,1,1)))
        for f in range(math.ceil(first*FPS),math.floor(last*FPS)+1):
            scene.frame_set(f);pm=Matrix.LocRotScale(bolt.location,bolt.rotation_quaternion.normalized(),Vector((1,1,1)))
            gm=CI.to_4x4()@pm@rest_matrix.inverted()@C.to_4x4()
            pose('right',f/FPS,gm@wrist,gm.to_quaternion()@q,data['pose'])
    begin('Bolt_Cycle',1.1);d=1.1
    # Gameplay schedules the cycle immediately on discharge, so this action
    # must include the initial trigger beat; Fire cannot play underneath it.
    key(trigger,.012,rot=(-8,0,0));key(trigger,.055,rot=(-8,0,0));key(trigger,.10)
    pull=copy.deepcopy(ref['sides']['right']['grip']);pull['fingers'][0]=[a+.002 for a in pull['fingers'][0]]
    pose('right',.012,p=pull);pose('right',.032,p=pull);pose('right',.055)
    for k,loc,rot in [(0,(0,0,0),(0,0,0)),(.12,(0,0,0),(0,0,0)),(.16,(0,0,0),(0,0,60)),(.22,(0,0,.100),(0,0,60)),(.40,(0,0,.100),(0,0,60)),(.52,(0,0,0),(0,0,60)),(.74,(0,0,0),(0,0,0)),(1,(0,0,0),(0,0,0))]:
        key(bolt,k*d,loc,rot)
    release_right(.055,.07*d);grasp_right(.032,.07*d)
    pose('right',.095*d,[.180,-.035,.114],p=ref['rightOpen']);pose('right',.105*d,[.180,.020,.085],Quaternion((ref['bolt']['quaternion'][3],*ref['bolt']['quaternion'][:3])),ref['bolt']['pose'])
    pose('right',.12*d,ref['bolt']['pos'],Quaternion((ref['bolt']['quaternion'][3],*ref['bolt']['quaternion'][:3])),ref['bolt']['pose'])
    follow_bolt(.12*d,.76*d)
    pose('right',.79*d,[.180,.020,.085],Quaternion((ref['bolt']['quaternion'][3],*ref['bolt']['quaternion'][:3])),ref['bolt']['pose'])
    pose('right',.82*d,[.180,-.035,.114],p=ref['rightOpen']);pose('right',.88*d,p=ref['rightOpen'])
    grasp_right(.88*d,.96*d,True);release_right(.96*d,d,True)
    clips['Bolt_Cycle']['events']=[{'time':.22*d,'event':'bolt:open'},{'time':.52*d,'event':'chamber'},{'time':.74*d,'event':'bolt:close'},{'time':.995*d,'event':'end'}]
    finish('Bolt_Cycle')
    for name,d,empty_reload in [('Reload_Tactical',2.8,False),('Reload_Empty',3.6,True)]:
        begin(name,d)
        out=.16 if empty_reload else .20;drop=.30 if empty_reload else .34;insert=.71 if empty_reload else .81;appear=drop+.045
        for k,loc,rot in [(.10,(.012,-.024,.02),(-8,16,23)),(.44,(.016,-.030,.026),(-7,20,28)),(.70,(.012,-.022,.022),(-7,16,25)),(.96,(0,0,0),(0,0,0))]:key(rig,k*d,loc,rot)
        for k,loc,scale in [(0,(0,0,0),1),(out-.025,(0,0,0),1),(out,(0,-.027,0),1),(drop-.02,(.01,-.20,.04),1),(drop,(.02,-.32,.06),0),(insert,(0,0,0),0),(insert+.04,(0,0,0),1),(1,(0,0,0),1)]:key(mag,k*d,loc,scale=scale)
        for k,loc,scale in [(0,(.02,-.32,.06),0),(appear,(.02,-.31,.05),1),(insert-.14,(.01,-.15,.02),1),(insert-.045,(0,-.035,0),1),(insert,(0,0,0),1),(insert+.039,(0,0,0),1),(insert+.04,(0,0,0),0),(1,(0,0,0),0)]:key(spare,k*d,loc,scale=scale)
        for k in ((.35,.60,.94) if empty_reload else (.06,.35,.60,.94)):pose('right',k*d,p=ref['rightIndexed'])
        if not empty_reload:
            release_right(0,.06*d);release_right(.94*d,d,True)
        mq=Quaternion((ref['magazine']['quaternion'][3],*ref['magazine']['quaternion'][:3]));mp=ref['magazine']['pose']
        # Native skin-fitted unwrap; the far fingers must clear before travel.
        for row in ref['release']:pose('left',.025*d*row['t'],row['pos'],p=row['pose'])
        pose('left',.065*d,[-.095,-.095,-.095],mq,ref['magazine']['open'])
        for row in ref['magazine']['grasp']:
            pose('left',(out-.055+.015*row['t'])*d,ref['magazine']['pos'],mq,row['pose'])
        # Keep the old grip until disappearance; opening it before the drop
        # swept the padded thumb through the magazine's rear/floor corner.
        pose('left',drop*d,Vector(ref['magazine']['pos'])+Vector((.02,-.32,.06)),mq,mp)
        pose('left',appear*d,Vector(ref['magazine']['pos'])+Vector((.02,-.31,.05)),mq,mp)
        pose('left',(insert+.03)*d,ref['magazine']['pos'],mq,mp)
        for row in ref['magazine']['grasp']:
            pose('left',(insert+.03+.025*(1-row['t']))*d,ref['magazine']['pos'],mq,row['pose'])
        pose('left',(insert+.08)*d,Vector(ref['magazine']['pos'])+Vector((-.045,-.040,.045)),mq,ref['magazine']['open'])
        for first,last,part in [(out-.04,drop,mag),(appear,insert+.03,spare)]:
            for f in range(math.ceil(first*d*FPS),math.floor(last*d*FPS)+1):
                scene.frame_set(f);pm=Matrix.LocRotScale(part.location,part.rotation_quaternion,Vector((1,1,1)));gm=CI.to_4x4()@pm@C.to_4x4()
                pose('left',f/FPS,gm@Vector(ref['magazine']['pos']),gm.to_quaternion()@mq,mp)
        if empty_reload:
            # Open without a second case event; the original last-shot ejection
            # timing is a retained gameplay simplification, not real mechanics.
            for k,z,angle in [(0,0,0),(.05,0,0),(.08,0,60),(.12,.100,60),(.86,.100,60),(.90,0,60),(.917,0,0),(1,0,0)]:key(bolt,k*d,(0,0,z),(0,0,angle))
            release_right(0,.012*d);grasp_right(0,.012*d)
            pose('right',.025*d,[.180,-.035,.114],p=ref['rightOpen'])
            pose('right',.040*d,[.180,.020,.085],Quaternion((ref['bolt']['quaternion'][3],*ref['bolt']['quaternion'][:3])),ref['bolt']['pose'])
            follow_bolt(.05*d,.13*d)
            pose('right',.15*d,[.180,.020,.085],Quaternion((ref['bolt']['quaternion'][3],*ref['bolt']['quaternion'][:3])),ref['bolt']['pose'])
            pose('right',.155*d,[.180,-.035,.114],p=ref['rightOpen']);pose('right',.17*d,p=ref['rightOpen'])
            grasp_right(.17*d,.24*d,True);grasp_right(.74*d,.78*d)
            # Stay seated until unwrap begins; otherwise the next lateral
            # waypoint's Bezier curve drags wrapped fingers through the grip.
            wrist=hand_controls['right']['wrist'];wrist.location=xyz(ref['grips']['right']['pos'])
            wrist.rotation_quaternion=quat(Quaternion((ref['sides']['right']['quaternion'][3],*ref['sides']['right']['quaternion'][:3])))
            for k in (.74,.78):
                wrist.keyframe_insert('location',frame=k*d*FPS);wrist.keyframe_insert('rotation_quaternion',frame=k*d*FPS)
            pose('right',.79*d,[.18,-.035,.114],p=ref['rightOpen'])
            follow_bolt(.83*d,.925*d)
            # Clear the housing laterally before rotating/unfolding the hand.
            pose('right',.935*d,[.180,.020,.085],Quaternion((ref['bolt']['quaternion'][3],*ref['bolt']['quaternion'][:3])),ref['bolt']['pose'])
            pose('right',.95*d,[.180,-.035,.114],p=ref['rightOpen']);pose('right',.97*d,p=ref['rightOpen'])
            grasp_right(.97*d,.985*d,True);release_right(.985*d,d,True)
        for row in ref['release']:pose('left',(.94+.04*(1-row['t']))*d,row['pos'],p=row['pose'])
        clips[name]['events']=[{'time':.02*d,'event':'start'},{'time':out*d,'event':'magout'},{'time':drop*d,'event':'magdrop'},{'time':insert*d,'event':'magin'}]
        clips[name]['events']+=([{'time':.90*d,'event':'charge'},{'time':.917*d,'event':'boltrelease'}] if empty_reload else [{'time':.88*d,'event':'slap'}])
        clips[name]['events'].append({'time':.995*d,'event':'end'})
        finish(name,[(0,.025*d),((out-.055)*d,(out-.04)*d),((insert+.03)*d,(insert+.055)*d),(.94*d,.98*d)])
    begin('Inspect',3.6)
    for t,loc,rot in [(.55,(-.12,.095,-.14),(-2,52,6)),(1.2,(-.12,.100,-.14),(3,46,2)),(1.95,(.03,.10,-.26),(-2,125,-4)),(2.45,(.03,.10,-.26),(-2,125,-4)),(3.1,(-.12,.095,-.14),(-2,52,6)),(3.6,(0,0,0),(0,0,0))]:key(rig,t,loc,rot)
    for t in (.20,.80,1.6,2.7,3.4):pose('right',t,p=ref['rightIndexed'])
    release_right(0,.20);release_right(3.4,3.6,True)
    for row in ref['release']:
        pose('left',.12*row['t'],row['pos'],p=row['pose'])
        pose('left',3.1+.3*(1-row['t']),row['pos'],p=row['pose'])
    for t,pos in [(.3,[-.09,-.12,-.14]),(.65,[-.12,-.19,-.12]),(2.6,[-.12,-.19,-.12])]:pose('left',t,pos,p=relaxed('left'))
    clips['Inspect']['events']=[{'time':.995*3.6,'event':'end'}];finish('Inspect',[(0,.12),(3.1,3.4)])
    for name,d,drawing in [('Draw',.88,True),('Holster',.56,False)]:
        begin(name,d)
        for k,amount in ([(0,1),(.25,.78),(.78,.04),(.93,0),(1,0)] if drawing else [(0,0),(.20,.08),(.75,.8),(1,1)]):
            key(rig,k*d,(.025*amount,-.13*amount,.24*amount),(-22*amount,20*amount,12*amount))
            # Keep the support grip on the rifle while drawing/holstering it.
            # Translating a still-wrapped hand pulled its far fingers through
            # the tube; the weapon/root motion already supplies the gesture.
            pose('left',k*d);pose('right',k*d,p=ref['rightIndexed'] if amount>.2 else None)
        release_right(.25*d,.78*d,True) if drawing else release_right(.20*d,.75*d)
        clips[name]['events']=[{'time':.995*d,'event':'end'}];finish(name)

    # Append the original glove/sleeve appearance and pose its real skin in
    # Blender. Exported controls drive those same named joints in the game.
    hand_collection=bpy.data.collections.new('AX338 | authored hands (shared appearance)')
    scene.collection.children.link(hand_collection)
    source=root/'assets/player/arms/player-arms.blend'
    with bpy.data.libraries.load(str(source),link=False) as (available,loaded):
        loaded.objects=list(available.objects)
    loaded_objects=[o for o in loaded.objects if o]
    source_rig=next(o for o in loaded_objects if o.type=='ARMATURE')
    source_meshes=[o for o in loaded_objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
    hands=[];armatures={}
    for side in ('left','right'):
        arm=source_rig.copy();arm.data=source_rig.data.copy();arm.animation_data_clear()
        arm.name='AX338_arm_'+side;hand_collection.objects.link(arm);hands.append(arm);armatures[side]=arm
        arm.parent=rig;arm.matrix_parent_inverse=Matrix.Identity(4)
        arm.location=(0,0,0);arm.rotation_euler=(0,0,0);arm.scale=(-1,1,1) if side=='right' else (.97,.97,.97)
        for o in source_meshes:
            clone=o.copy();clone.data=o.data;clone.name='AX338_'+side+'_'+o.name
            hand_collection.objects.link(clone);clone.parent=arm;clone.matrix_parent_inverse=Matrix.Identity(4)
            clone.location=(0,0,0);clone.rotation_euler=(0,0,0);clone.scale=(1,1,1)
            for mod in clone.modifiers:
                if mod.type=='ARMATURE':mod.object=arm
            hands.append(clone)
    # Only appended resources used by these copies survive in the scene.
    for o in loaded_objects:bpy.data.objects.remove(o,do_unlink=True)
    lengths=[[.045,.028,.022],[.049,.031,.023],[.046,.029,.022],[.038,.024,.020]]
    xs=[.0298,.0102,-.0104,-.0298]
    def mat(pos=(0,0,0),q=None,scale=(1,1,1)):
        return Matrix.LocRotScale(Vector(pos),q or Quaternion(),Vector(scale))
    def from_control(o):return CI@o.rotation_quaternion.to_matrix()@C
    def game_matrices(side,bind=False):
        cs=hand_controls[side];mirror=-1 if side=='right' else 1
        wrist=Matrix.Identity(4) if bind else mat(CI@cs['wrist'].location,from_control(cs['wrist']).to_quaternion())
        scale=.97 if side=='left' else 1
        inner=wrist@mat(scale=(mirror*scale,scale,scale));out={'hand':wrist}
        for i in range(4):
            q=eq((0,-xs[i]*2.2,0)) if bind else from_control(cs[f'finger_{i}_root']).to_quaternion()
            parent=inner@mat((xs[i],-.006,-.096),q)
            for j in range(3):
                q=Quaternion() if bind else from_control(cs[f'finger_{i}_{j}']).to_quaternion()
                tr=(0,0,-lengths[i][j-1]) if j else (0,0,0)
                if j:out[f'finger_{i}_{j}_flex']=parent@mat(tr,Quaternion().slerp(q,.5))
                parent=parent@mat(tr,q);out[f'finger_{i}_{j}']=parent
        tq=eq((0,-.95,0)) if bind else from_control(cs['thumb_base']).to_quaternion()
        out['thumb_base']=inner@mat((.037,-.009,-.040),tq)
        out['thumb_web']=inner@mat((.037,-.009,-.040),eq((0,-.95,0)).slerp(tq,.5))
        parent=out['thumb_base']
        for j in range(2):
            q=Quaternion() if bind else from_control(cs[f'thumb_{j}']).to_quaternion()
            tr=(0,0,-.05) if j else (0,0,0)
            if j:out['thumb_1_flex']=parent@mat(tr,Quaternion().slerp(q,.5))
            parent=parent@mat(tr,q);out[f'thumb_{j}']=parent
        if bind:
            out['upper']=mat((0,0,.63*scale));out['fore']=mat((0,0,.3*scale))
        else:
            shoulder=Vector((-.29,-.04,.50) if side=='left' else (.075,-.04,.50))
            hand=wrist.translation;delta=hand-shoulder;d=max(.04,min(.627,delta.length));direction=delta.normalized()
            pole=Vector((-.4 if side=='left' else .4,-.7,.7));pole=(pole-direction*pole.dot(direction)).normalized()
            a=(.33**2+d*d-.30**2)/(2*d);h=math.sqrt(max(0,.33**2-a*a));elbow=shoulder+direction*a+pole*h
            for name,start,end in [('upper',shoulder,elbow),('fore',elbow,hand)]:
                z=(start-end).normalized();y=Vector((0,1,0));y=(y-z*y.dot(z)).normalized();x=y.cross(z)
                q=Matrix((x,y,z)).transposed().to_quaternion();out[name]=mat(start,q)
        return out
    bind={s:game_matrices(s,True) for s in armatures}
    cm=C.to_4x4();cmi=CI.to_4x4()
    for name,info in clips.items():
        for o in all_parts:
            for track in o.animation_data.nla_tracks:track.mute=track.name!=name
        for side,arm in armatures.items():
            arm.animation_data_create();arm.animation_data.action=bpy.data.actions.new(name+' | '+arm.name)
            for t in arm.animation_data.nla_tracks:t.mute=True
        for f in range(0,math.ceil(info['frames'][1])+1,2):
            scene.frame_set(f)
            for side,arm in armatures.items():
                current=game_matrices(side);s=Matrix.Diagonal((-1,1,1,1) if side=='right' else (.97,.97,.97,1))
                desired={}
                for pb in arm.pose.bones:
                    transform=cm@current[pb.name]@bind[side][pb.name].inverted()@cmi
                    desired[pb.name]=s.inverted()@transform@s@pb.bone.matrix_local
                for pb in arm.pose.bones:
                    pb.rotation_mode='QUATERNION'
                    # Solve basis explicitly. Assigning pb.matrix sequentially
                    # consults stale evaluated parent poses until depsgraph update.
                    basis=pb.bone.matrix_local.inverted()
                    if pb.parent:
                        basis=basis@pb.parent.bone.matrix_local@desired[pb.parent.name].inverted()
                    pb.matrix_basis=basis@desired[pb.name]
                    for prop in ('location','rotation_quaternion','scale'):pb.keyframe_insert(prop,frame=f,group=pb.name)
        for arm in armatures.values():
            ad=arm.animation_data;a=ad.action;t=ad.nla_tracks.new();t.name=name
            st=t.strips.new(name,0,a);st.action_frame_start=0;st.action_frame_end=math.ceil(info['frames'][1]);st.extrapolation='HOLD'
            ad.action=None;t.mute=True
    return clips,controls,hands
