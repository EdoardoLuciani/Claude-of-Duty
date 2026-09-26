"""Blender P320 action authoring. Called by p320_compact.py, not at runtime.
Wrist trajectories and every finger/ thumb channel are Blender actions. Shared
arm skins are appended for DCC review; runtime reuses the game's same skins.
"""
import copy
import json
import math
import bpy
from mathutils import Vector, Quaternion, Euler, Matrix

C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
CI=C.inverted()

def xyz(v):return C@Vector(v)
def quat(q):return (C@q.to_matrix()@CI).to_quaternion()
def eq(e):
    # Three's intrinsic XYZ composes Rx*Ry*Rz; mathutils Euler XYZ uses the
    # opposite multiplication order. Single hinges hid this on finger tests.
    return Quaternion((1,0,0),e[0]) @ Quaternion((0,1,0),e[1]) @ Quaternion((0,0,1),e[2])

def author_actions(root,asset,rig,parts,mag,spare,slide,barrel,trigger,catch,round_live):
    scene=bpy.context.scene
    ref=json.loads((root/'assets/weapons/p320-compact/hand-reference.json').read_text())
    controls=[];hand_controls={}
    def control(name):
        o=bpy.data.objects.new(name,None);asset.objects.link(o);o.parent=rig
        o.rotation_mode='QUATERNION';o.empty_display_size=.004
        controls.append(o);return o
    for side,prefix in [('left','L'),('right','R')]:
        values={'wrist':control('hand_'+prefix)}
        for i in range(4):
            values[f'finger_{i}_root']=control(f'{prefix}_finger_{i}_root')
            for j in range(3):values[f'finger_{i}_{j}']=control(f'{prefix}_finger_{i}_{j}')
        for name in ('thumb_base','thumb_0','thumb_1'):values[name]=control(prefix+'_'+name)
        hand_controls[side]=values
    all_parts=parts+controls
    bpy.context.view_layer.update()
    rest={o.name:(o.location.copy(),o.rotation_euler.copy(),o.scale.copy()) for o in parts}
    clips={}
    def key(o,f,loc=(0,0,0),rot=(0,0,0),scale=1):
        base=rest[o.name];o.location=base[0]+Vector(loc)
        o.rotation_euler=Vector(base[1])+Vector(tuple(math.radians(v) for v in rot));o.scale=(scale,)*3
        for p in ('location','rotation_euler','scale'):o.keyframe_insert(p,frame=f,group=o.name)
    def pose(side,f,pos=None,q=None,p=None):
        data=ref['sides'][side];cs=hand_controls[side]
        pos=pos if pos is not None else ref['grips'][side]['pos']
        q=q if q is not None else Quaternion((data['quaternion'][3],*data['quaternion'][:3]))
        p=p if p is not None else data['grip']
        wrist=cs['wrist'];wrist.location=xyz(pos);wrist.rotation_quaternion=quat(q)
        wrist.keyframe_insert('location',frame=f);wrist.keyframe_insert('rotation_quaternion',frame=f)
        for i in range(4):
            o=cs[f'finger_{i}_root'];o.rotation_quaternion=quat(eq((0,p['fingerSpread'][i],0)));o.keyframe_insert('rotation_quaternion',frame=f)
            for j in range(3):
                o=cs[f'finger_{i}_{j}'];o.rotation_quaternion=quat(eq((-p['fingers'][i][j],0,0)));o.keyframe_insert('rotation_quaternion',frame=f)
        o=cs['thumb_base'];o.rotation_quaternion=quat(eq(p['thumbBase']));o.keyframe_insert('rotation_quaternion',frame=f)
        for j in range(2):
            o=cs[f'thumb_{j}'];o.rotation_quaternion=quat(eq((-p['thumb'][j],0,0)));o.keyframe_insert('rotation_quaternion',frame=f)
    def begin(name,end):
        clips[name]={'frames':[0,end],'duration':end/60,'loop':name=='Idle','events':[]}
        for o in all_parts:
            o.animation_data_create();o.animation_data.action=None
            for t in o.animation_data.nla_tracks:t.mute=True
            o.animation_data.action=bpy.data.actions.new(name+' | '+o.name)
        for o in parts:
            key(o,0,scale=0 if o==spare else 1);key(o,end,scale=0 if o==spare else 1)
        for side in ('left','right'):pose(side,0);pose(side,end)
    def finish(name,end):
        for o in all_parts:
            ad=o.animation_data;action=ad.action
            for layer in action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for point in curve.keyframe_points:
                                point.interpolation='CONSTANT' if curve.data_path=='scale' else 'BEZIER'
                                point.handle_left_type='AUTO_CLAMPED';point.handle_right_type='AUTO_CLAMPED'
            track=ad.nla_tracks.new();track.name=name
            strip=track.strips.new(name,0,action);strip.action_frame_start=0;strip.action_frame_end=end
            strip.extrapolation='HOLD';strip.blend_type='REPLACE'
            ad.action=None;track.mute=True
    def relaxed(side):
        p=copy.deepcopy(ref['sides'][side]['grip'])
        p['fingers']=[[.15,.25,.18],[.20,.30,.20],[.25,.32,.24],[.32,.36,.27]]
        p['thumb']=[.12,.20]
        return p
    # Trigger finger is visibly indexed during handling rather than welded to blade.
    def indexed():
        p=copy.deepcopy(ref['sides']['right']['grip'])
        p['fingers'][0]=[-.05,.10,.15];p['fingerSpread'][0]=.32
        return p
    begin('Idle',120)
    for f,z,a in [(30,.00025,.10),(90,-.00025,-.10)]:key(rig,f,(0,0,z),(a,0,0))
    finish('Idle',120)
    for name,locked in [('Fire',False),('Last_Shot',True)]:
        begin(name,12)
        if locked:
            key(round_live,1,scale=0);key(round_live,12,scale=0)
        # Authored visual cycle and recoil; the game keeps its ballistic/camera
        # recoil but does not add a second weapon-space spring impulse.
        for f,loc,rot in [(1,(0,-.009,.0015),(3.8,0,.35)),(3,(0,-.006,.003),(2.7,0,-.2)),(8,(0,.0006,0),(-.15,0,0))]:key(rig,f,loc,rot)
        for f,y in [(0,0),(2,-.027),(4,-.026),(7,-.027 if locked else 0),(12,-.027 if locked else 0)]:key(slide,f,(0,y,0))
        for f,y,a in [(0,0,0),(2,-.004,3.5),(4,-.004,3.5),(7,-.004 if locked else 0,3.5 if locked else 0),(12,-.004 if locked else 0,3.5 if locked else 0)]:key(barrel,f,(0,y,0),(a,0,0))
        for f,a in [(0,0),(1,-12),(4,-12),(8,0)]:key(trigger,f,rot=(a,0,0))
        p=copy.deepcopy(ref['sides']['right']['grip']);p['fingers'][0]=[a+.045 for a in p['fingers'][0]]
        pose('right',1,p=p);pose('right',4,p=p);pose('right',8)
        clips[name]['events']=[{'time':0,'event':'shot'},{'time':2/60,'event':'casing_eject'}]
        finish(name,12)
    # Hand paths, magazines and finger changes are synchronized in the DCC.
    # At the below-frame handoff both magazines remain discrete objects.
    for name,end,empty_reload in [('Reload_Tactical',144,False),('Reload_Empty',162,True)]:
        begin(name,end)
        for f,loc,rot in [(15,(.008,-.016,.003),(10,-18,5)),(32,(.014,-.024,.009),(12,-22,7)),(75,(.012,-.023,.008),(12,-22,7)),(108,(.010,-.017,.003),(8,-15,5)),(end-12,(0,0,0),(0,0,0))]:key(rig,f,loc,rot)
        # Seated -> departing -> offscreen old magazine. Empty falls, tactical held.
        for f,loc,rot,s in [(18,(0,0,0),(0,0,0),1),(28,(0,-.005,-.022),(0,0,0),1),
                            (43,(-.012,-.030,-.16),(10,0,-8),1),(58,(-.03,-.055,-.31),(18,0,-16),1),
                            (60,(-.03,-.055,-.34),(18,0,-16),0),(end-1,(0,0,0),(0,0,0),0)]:key(mag,f,loc,rot,s)
        for f,loc,rot,s in [(58,(-.03,-.04,-.32),(-10,0,-10),0),(60,(-.03,-.04,-.29),(-10,0,-10),1),
                            (78,(-.016,-.025,-.16),(-8,0,-7),1),(94,(-.005,-.011,-.045),(-4,0,-2),1),
                            (103,(0,.0005,.003),(0,0,0),1),(107,(0,0,0),(0,0,0),1),(end-1,(0,0,0),(0,0,0),1)]:key(spare,f,loc,rot,s)
        # Final frame atomically exchanges meshes; end-1 is not double visible.
        key(spare,end,scale=0);key(mag,end)
        for f in [10,18,30,65,100,end-20]:pose('right',f,p=indexed())
        release=copy.deepcopy(ref['sides']['right']['release']);release['fingers'][0]=indexed()['fingers'][0];release['fingerSpread'][0]=.32
        pose('right',20,p=release);pose('right',27,p=release);pose('right',38,p=indexed())
        # Support wrist wraps the magazine below its base, with fingers curling
        # around its body instead of an open hand following a floating magazine.
        magpose=copy.deepcopy(ref['magazine']['pose'])
        # Wrist rotations are genuine keyframed quaternions, not runtime offsets.
        mq=Quaternion((ref['magazine']['quaternion'][3],*ref['magazine']['quaternion'][:3]))
        sequence=[(10,[-.048,-.075,.066],None,relaxed('left')),
                  (19,[-.046,-.104,.042],mq,magpose),
                  (28,[-.046,-.126,.047],mq,magpose),
                  (43,[-.058,-.254,.072],mq,magpose),
                  (58,[-.076,-.40,.10],mq,magpose),
                  (61,[-.076,-.382,.087],mq,magpose),
                  (78,[-.062,-.254,.067],mq,magpose),
                  (94,[-.051,-.139,.053],mq,magpose),
                  (103,[-.046,-.091,.042],mq,magpose),
                  (109,[-.048,-.102,.048],mq,magpose),
                  (end-12,ref['grips']['left']['pos'],None,ref['sides']['left']['grip'])]
        if empty_reload:
            key(round_live,0,scale=0);key(round_live,end-1,scale=0);key(round_live,end)
            # Old mag falls without the support hand; hand retrieves the fresh one.
            sequence[1]=(19,[-.090,-.16,.13],None,relaxed('left'))
            sequence[2]=(28,[-.090,-.27,.14],mq,relaxed('left'))
            sequence += [(120,ref['grips']['left']['pos'],None,ref['sides']['left']['release']),
                         (128,ref['grips']['left']['pos'],None,ref['sides']['left']['release']),
                         (138,ref['grips']['left']['pos'],None,ref['sides']['left']['grip'])]
            for f,y in [(0,-.027),(126,-.027),(129,0),(end,0)]:key(slide,f,(0,y,0))
            for f,y,a in [(0,-.004,3.5),(126,-.004,3.5),(129,0,0),(end,0,0)]:key(barrel,f,(0,y,0),(a,0,0))
            key(catch,125,rot=(0,0,0));key(catch,127,rot=(0,-8,0));key(catch,133)
        for f,pos,q,p in sorted(sequence,key=lambda t:t[0]):pose('left',f,pos,q,p)
        # Bake the retained/fresh magazine contact from the SAME authored part
        # transforms. Dense sampling preserves contact through curved wrist motion.
        for first,last,part in ([] if empty_reload else [(19,58,mag)])+[(61,109,spare)]:
            for f in range(first,last+1):
                scene.frame_set(f)
                pm=Matrix.LocRotScale(part.location,part.rotation_euler.to_quaternion(),Vector((1,1,1)))
                gm=CI.to_4x4()@pm@C.to_4x4()
                pos=gm@Vector(ref['magazine']['pos']);q=gm.to_quaternion()@mq
                pose('left',f,pos,q,magpose)
        clips[name]['events']=[{'time':28/60,'event':'magazine_out'},{'time':103/60,'event':'magazine_in'}]
        if empty_reload:clips[name]['events'].append({'time':129/60,'event':'bolt_forward'})
        finish(name,end)
    begin('Inspect',198)
    for f,loc,rot in [(28,(.0,-.025,.012),(8,-30,10)),(65,(.0,-.025,.012),(8,-30,10)),
                      (110,(-.015,-.020,.020),(-3,35,-8)),(151,(-.015,-.020,.020),(-3,35,-8)),(186,(0,0,0),(0,0,0))]:key(rig,f,loc,rot)
    for f in [15,45,100,165]:pose('right',f,p=indexed())
    for f,pos in [(18,[-.068,-.11,.09]),(45,[-.09,-.18,.10]),(145,[-.09,-.18,.10]),(180,ref['grips']['left']['pos'])]:pose('left',f,pos,p=relaxed('left') if f<180 else None)
    finish('Inspect',198)
    for name,end,drawing in [('Draw',30,True),('Holster',24,False)]:
        begin(name,end)
        for f,k in ([(0,1),(8,.76),(21,.04),(30,0)] if drawing else [(0,0),(7,.08),(18,.80),(24,1)]):
            key(rig,f,(.045*k,-.08*k,-.22*k),(38*k,-12*k,12*k))
            pos=Vector(ref['grips']['left']['pos'])+Vector((-.065*k,-.075*k,.02*k))
            pose('left',f,pos,p=relaxed('left') if k>.2 else None)
            pose('right',f,p=indexed() if k>.2 else None)
        finish(name,end)

    # Append the original glove/sleeve appearance and pose its real skin in
    # Blender. Exported controls drive those same named joints in the game.
    hand_collection=bpy.data.collections.new('P320 | authored hands (shared appearance)')
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
        arm.name='P320_arm_'+side;hand_collection.objects.link(arm);hands.append(arm);armatures[side]=arm
        arm.parent=rig;arm.matrix_parent_inverse=Matrix.Identity(4)
        arm.location=(0,0,0);arm.rotation_euler=(0,0,0);arm.scale=(-1,1,1) if side=='right' else (.97,.97,.97)
        for o in source_meshes:
            clone=o.copy();clone.data=o.data;clone.name='P320_'+side+'_'+o.name
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
        for f in range(0,info['frames'][1]+1,2):
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
            st=t.strips.new(name,0,a);st.action_frame_start=0;st.action_frame_end=info['frames'][1];st.extrapolation='HOLD'
            ad.action=None;t.mute=True
    return clips,controls,hands
