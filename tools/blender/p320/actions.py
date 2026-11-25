"""Blender P320 action authoring. Called by build.py, not at runtime.
Wrist trajectories and every finger/ thumb channel are Blender actions. Shared
arm skins are appended for DCC review; runtime reuses the game's same skins.
"""
import copy
import json
import math
import bpy
from mathutils import Vector, Quaternion, Matrix
from review_hands import author_review_hands, eq

C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
CI=C.inverted()

def xyz(v):return C@Vector(v)
def quat(q):return (C@q.to_matrix()@CI).to_quaternion()

def author_actions(root,asset,rig,parts,mag,spare,slide,barrel,trigger,catch,round_live):
    scene=bpy.context.scene
    ref=json.loads((root/'src/weapons/authored/p320-compact/hand-reference.json').read_text())
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
        o=cs['thumb_base'];o.rotation_quaternion=quat(eq(p['thumbBase']))
        # Blender interpolates quaternion components, not shortest-arc slerp.
        # The right release pose crosses the +/-pi Euler seam; keep its sign
        # compatible with the grip so the baked frames cannot spin backwards.
        if side=='right':o.rotation_quaternion.make_compatible(quat(eq(data['grip']['thumbBase'])))
        o.keyframe_insert('rotation_quaternion',frame=f)
        for j in range(2):
            o=cs[f'thumb_{j}'];o.rotation_quaternion=quat(eq((-p['thumb'][j],0,0)));o.keyframe_insert('rotation_quaternion',frame=f)
    def begin(name,end):
        clips[name]={'frames':[0,end],'duration':end/60,'events':[]}
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
    def indexed(curled=False):
        p=copy.deepcopy(ref['sides']['right']['grip'])
        if curled:p['fingers'][0][0]=-.6
        else:p['fingers'][0]=[-.25,.05,.08];p['fingerSpread'][0]=.32
        return p
    begin('Idle',0)  # single rest pose; procedural sway owns idle motion
    finish('Idle',0)
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
        # Keep the right thumb in its normal grip for the entire reload.
        # Only the trigger finger changes pose; no magazine-release gesture.
        # Lift the still-curled index before extending it above the rearward pad.
        for f in [4,end-10]:pose('right',f,p=indexed(curled=True))
        for f in [10,20,27,38,65,100,end-20]:pose('right',f,p=indexed())
        # Support wrist wraps the magazine below its base, with fingers curling
        # around its body instead of an open hand following a floating magazine.
        magpose=copy.deepcopy(ref['magazine']['pose'])
        # Wrist rotations are genuine keyframed quaternions, not runtime offsets.
        mq=Quaternion((ref['magazine']['quaternion'][3],*ref['magazine']['quaternion'][:3]))
        # Peel away outboard before opening the fingers beside the compact laser seat.
        sequence=[(4,[-.067,-.065,.072],None,ref['sides']['left']['grip']),
                  (10,[-.075,-.095,.072],None,relaxed('left')),
                  (19,[-.046,-.104,.042],mq,magpose),
                  (28,[-.046,-.126,.047],mq,magpose),
                  (43,[-.058,-.254,.072],mq,magpose),
                  (58,[-.076,-.40,.10],mq,magpose),
                  (61,[-.076,-.382,.087],mq,magpose),
                  (78,[-.062,-.254,.067],mq,magpose),
                  (94,[-.051,-.139,.053],mq,magpose),
                  (103,[-.046,-.091,.042],mq,magpose),
                  (109,[-.048,-.102,.048],mq,magpose),
                  (114 if empty_reload else end-18,[-.075,-.095,.072],None,ref['sides']['left']['grip']),
                  (end-12,ref['grips']['left']['pos'],None,ref['sides']['left']['grip'])]
        if empty_reload:
            key(round_live,0,scale=0);key(round_live,end-1,scale=0);key(round_live,end)
            # Old mag falls without the support hand; hand retrieves the fresh one.
            sequence=[k for k in sequence if k[0] not in (19,28)]
            sequence += [(19,[-.090,-.16,.13],None,relaxed('left')),
                         (28,[-.090,-.27,.14],mq,relaxed('left')),
                         (120,ref['grips']['left']['pos'],None,ref['sides']['left']['release']),
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
    # CS2 Glock reference: quick one-handed lift into a sustained side profile,
    # then curl the fingers and roll up to the top of the slide before regripping.
    inspect_end=372
    begin('Inspect',inspect_end)
    for f,loc,rot in [
        (6,(0,-.010,-.010),(-4,0,2)),
        (17,(.039,-.068,.080),(10,5,46)),
        (30,(.046,-.087,.136),(20,7,79)),
        (53,(.037,-.081,.104),(14,6,77)),
        (179,(.031,-.080,.102),(13,8,78)),
        (203,(.009,-.094,.112),(6,4,83)),
        (222,(.008,-.081,.115),(35,-20,63)),
        (235,(.007,-.083,.111),(76,-48,-10)),
        (248,(.014,-.073,.100),(93,-49,-42)),
        (278,(.023,-.067,.097),(78,-41,-28)),
        (301,(.022,-.057,.089),(66,-33,-18)),
        (321,(.025,-.045,.076),(43,1,27)),
        (340,(.012,-.013,.005),(9,-2,7)),
        (366,(0,0,0),(0,0,0)),
    ]:key(rig,f,loc,rot)

    # The single-hand presentation needs a grip fitted on the actual P320
    # mesh: the index enters from the side and curls onto the blade, while
    # the other fingers wrap the frontstrap. Keep that contact through the roll.
    wrist=(.04138,-.04880,.10400)
    wrist_rotation=Quaternion((.737402,.051369,.128339,-.661157))
    grip={
        'fingerSpread':[.361,.570,.459,.341],
        'fingers':[[-.326,1.262,.275],[.068,1.830,.738],[.316,1.765,.677],[.547,1.602,.726]],
        'thumbBase':[-.971,-.098,-2.955],
        'thumb':[.047,.921],
    }
    # Peel the thumb back around the tang before lifting it. The fingers stay seated.
    peel={**grip,'thumbBase':[-1.953,-.891,2.463],'thumb':[.07,.52]}
    offered={**grip,'thumbBase':[1.775,-1.412,-.362],'thumb':[.10,.15]}
    for f,p in [(9,grip),(20,peel),(37,offered),(182,offered),(208,peel),(220,grip),(364,grip)]:
        pose('right',f,wrist,wrist_rotation,p)

    # Leave the grip outboard before the turn. While detached, key the wrist in
    # ready space so it drops below view instead of orbiting with the slide.
    left=ref['sides']['left']
    x,y,z,w=left['quaternion'];lq=Quaternion((w,x,y,z))
    loose=relaxed('left')
    pose('left',5,(-.060,-.059,.079))
    for f,pos,p in [
        (12,(-.105,-.092,.097),left['grip']),
        (23,(-.148,-.197,.117),loose),
        *((f,(-.142,-.246,.101),loose) for f in (38,179,222,235,248,278,301)),
        (321,(-.127,-.229,.104),loose),
        (338,(-.105,-.128,.097),loose),
    ]:
        scene.frame_set(f)
        unrotate=CI.to_4x4()@rig.matrix_basis.inverted()@C.to_4x4()
        pose('left',f,unrotate@Vector(pos),unrotate.to_quaternion()@lq,p)
    pose('left',351,(-.065,-.065,.083))
    pose('left',365)
    finish('Inspect',inspect_end)
    for name,end,drawing in [('Draw',30,True),('Holster',24,False)]:
        begin(name,end)
        for f,k in ([(0,1),(8,.76),(21,.04),(30,0)] if drawing else [(0,0),(7,.08),(18,.80),(24,1)]):
            key(rig,f,(.045*k,-.08*k,-.22*k),(38*k,-12*k,12*k))
            pos=Vector(ref['grips']['left']['pos'])+Vector((-.065*k,-.075*k,.02*k))
            pose('left',f,pos,p=relaxed('left') if k>.2 else None)
            pose('right',f,p=indexed() if k>.2 else None)
        pose('right',15 if drawing else 12,p=indexed(curled=True))
        finish(name,end)

    # Shared review skins are baked from these controls, never exported.
    hands=author_review_hands(root,rig,hand_controls,all_parts,clips,basis=C,label='P320')
    return clips,controls,hands
