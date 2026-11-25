"""MCX wrist/finger and equip actions; only the shared arm IK remains runtime-owned.
Sparse BEZIER poses like the other weapons; contact windows follow the moving part.
"""
import json
import math

import bpy
from mathutils import Matrix, Quaternion, Vector
from mcx.animations import CHARGE, FPS, MAG_OUT, SPARE_IN
from review_hands import author_review_hands, eq

# Game -Z forward -> source +X forward. The manifest records RUNTIME_ORIGIN, the
# game-space position of the source origin, for the runtime rebase.
C = Matrix(((0,0,-1),(-1,0,0),(0,1,0)))
CI = C.inverted()
RUNTIME_ORIGIN = (0,.07,-.14)
ORIGIN = Vector(RUNTIME_ORIGIN)
FRAME = Matrix.Translation(ORIGIN) @ CI.to_4x4()
GLTF_TO_SOURCE = Matrix.Rotation(math.pi/2,4,'X')


def fcurves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags: yield from bag.fcurves


def native(q):
    return (C @ q.to_matrix() @ CI).to_quaternion()


def basis(finger,back):
    z = -Vector(finger).normalized(); y = Vector(back); y = (y-z*y.dot(z)).normalized()
    return Matrix((y.cross(z),y,z)).transposed().to_quaternion()


def author_hands(root,asset,parts,clips):
    scene = bpy.context.scene
    rig,mag,spare,_,handle,*_ = parts
    ref = json.loads((root/'src/weapons/authored/mcx-virtus/hand-reference.json').read_text())
    controls = []; hands = {}
    def control(name):
        obj = bpy.data.objects.new(name,None); asset.objects.link(obj); obj.parent = rig
        obj.rotation_mode = 'QUATERNION'; obj.empty_display_size = .004; controls.append(obj)
        return obj
    for side,prefix in [('left','L'),('right','R')]:
        cs = {'wrist':control('hand_'+prefix)}
        for i in range(4):
            cs[f'finger_{i}_root'] = control(f'{prefix}_finger_{i}_root')
            for j in range(3): cs[f'finger_{i}_{j}'] = control(f'{prefix}_finger_{i}_{j}')
        for name in ('thumb_base','thumb_0','thumb_1'): cs[name] = control(prefix+'_'+name)
        hands[side] = cs

    grip = {side:ref['sides'][side]['grip'] for side in hands}
    # Pinch/open replace the support curl; the fitted spread is retained.
    def curl(other):
        return {**grip['left'],'fingers':other['fingers'],'thumb':other['thumb'],'thumbBase':other['thumbBase']}
    pinch,opened = curl(ref['pinch']),curl(ref['open'])
    held = {side:(C @ (Vector(ref['grips'][side]['pos'])-ORIGIN),native(Quaternion((ref['sides'][side]['quaternion'][3],*ref['sides'][side]['quaternion'][:3])))) for side in hands}
    rest = held['left'][0]
    def key(obj,prop,value,f):
        setattr(obj,prop,value); obj.keyframe_insert(prop,frame=f)
    def wrist(side,t,pos=None,q=None):
        key(hands[side]['wrist'],'location',pos if pos is not None else held[side][0],t*FPS)
        key(hands[side]['wrist'],'rotation_quaternion',q if q is not None else held[side][1],t*FPS)
    def pose(side,t,pos=None,q=None,p=None):
        cs = hands[side]; f = t*FPS; p = p or grip[side]
        wrist(side,t,pos,q)
        for i in range(4):
            key(cs[f'finger_{i}_root'],'rotation_quaternion',native(eq((0,p['fingerSpread'][i],0))),f)
            for j in range(3): key(cs[f'finger_{i}_{j}'],'rotation_quaternion',native(eq((-p['fingers'][i][j],0,0))),f)
        key(cs['thumb_base'],'rotation_quaternion',native(eq(p['thumbBase'])),f)
        for j in range(2): key(cs[f'thumb_{j}'],'rotation_quaternion',native(eq((-p['thumb'][j],0,0))),f)
    # Rigid contact on a moving part. Hidden-magazine STEP scales never collapse it.
    magazine = (Vector((-.007,-.139,-.049)),basis((.1,.72,-.68),(-.86,.34,-.38)))
    latch = (Vector((-.184,.02,-.05)),basis((.55,.2,.81),(-.2,.94,-.27)))
    def contact(part,grasp,frame):
        scene.frame_set(math.floor(frame),subframe=frame%1)
        rotation = part.rotation_euler.to_quaternion()
        return Matrix.LocRotScale(part.location,rotation,Vector((1,1,1))) @ (GLTF_TO_SOURCE @ grasp[0]),rotation @ native(grasp[1])
    def follow(part,grasp,first,last):
        # The pinch holds through the window; only the wrist rides the part.
        for f in range(first,last+1):
            pos,q = contact(part,grasp,f)
            if f in (first,last): pose('left',f/FPS,pos,q,pinch)
            else: wrist('left',f/FPS,pos,q)
    def lowered(pos,amount): return pos+C @ Vector((0,-amount,0))

    def begin(name):
        for obj in parts:
            for track in obj.animation_data.nla_tracks: track.mute = track.name!=name
        for obj in controls:
            obj.animation_data_create(); obj.animation_data.action = bpy.data.actions.new(name+' | '+obj.name)
            for track in obj.animation_data.nla_tracks: track.mute = True
        for side in hands: pose(side,0); pose(side,clips[name]['duration'])
    def interpolate(action,out):
        # Each quaternion key takes the hemisphere nearest the previous key in time.
        rotation = sorted((c for c in fcurves(action) if c.data_path=='rotation_quaternion'),key=lambda c:c.array_index)
        for k in range(1,len(rotation[0].keyframe_points) if rotation else 0):
            if sum(c.keyframe_points[k].co.y*c.keyframe_points[k-1].co.y for c in rotation) < 0:
                for c in rotation: c.keyframe_points[k].co.y *= -1
        # BEZIER poses; `out` frames start a cubic ease-out (fast leave, soft arrival).
        for curve in fcurves(action):
            for point in curve.keyframe_points:
                eased = any(abs(point.co.x-f) < 1e-3 for f in out)
                point.interpolation = 'CUBIC' if eased else 'BEZIER'
                if eased: point.easing = 'EASE_OUT'
                point.handle_left_type = 'AUTO_CLAMPED'; point.handle_right_type = 'AUTO_CLAMPED'
            curve.update()
    def finish(name,out=()):
        for obj in controls:
            ad = obj.animation_data; action = ad.action; interpolate(action,out)
            track = ad.nla_tracks.new(); track.name = name
            strip = track.strips.new(name,0,action); strip.action_frame_start = 0
            strip.action_frame_end = clips[name]['frames'][1]; strip.extrapolation = 'HOLD'
            ad.action = None; track.mute = True

    # Equip motion is an ordinary native rig action, like the other weapon adapters.
    equip = {
        'Draw': (.62,(0,.48),[(0,(.05,-.3,.14),(-.85,.5,.55)),(.34,(.01,-.03,.02),(-.1,.06,.06)),(.48,(-.004,.008,-.006),(.04,-.02,-.02)),(.62,(0,0,0),(0,0,0))]),
        'Holster': (.4,(.1,),[(0,(0,0,0),(0,0,0)),(.1,(.004,.014,-.01),(.08,-.04,-.05)),(.4,(.05,-.32,.15),(-.9,.55,.6))]),
    }
    for name,(duration,out,keys) in equip.items():
        clips[name] = {'frames':[0,duration*FPS],'duration':duration,'events':[]}
        for obj in parts:
            ad = obj.animation_data
            for track in ad.nla_tracks: track.mute = True
            idle = next(t for t in ad.nla_tracks if t.name=='Idle').strips[0].action
            action = bpy.data.actions.new(name+' | '+obj.name) if obj==rig else idle.copy()
            ad.action = action
            if obj==rig:
                for t,pos,rot in keys:
                    transform = FRAME.inverted() @ Matrix.LocRotScale(Vector(pos),eq(rot),Vector((1,1,1))) @ FRAME
                    rig.location = transform.translation
                    rig.rotation_euler = transform.to_euler('XYZ',rig.rotation_euler)
                    for prop in ('location','rotation_euler','scale'): rig.keyframe_insert(prop,frame=t*FPS)
                interpolate(action,[t*FPS for t in out])
            track = ad.nla_tracks.new(); track.name = name
            strip = track.strips.new(name,0,action)
            strip.action_frame_start = 0; strip.action_frame_end = duration*FPS; strip.extrapolation = 'HOLD'
            ad.action = None; track.mute = True

    for name in clips:
        begin(name)
        if name.startswith('Reload'):
            empty = name=='Reload_Empty'
            # Drop the wrist clear of the laser bracket before reaching back to the magazine.
            pose('left',.1,lowered(rest,.008))
            follow(mag,magazine,*MAG_OUT)
            follow(spare,magazine,*SPARE_IN)
            if empty:
                # Stay below the optic until the latch clears it rearward, ride
                # the rest of its stroke, then return low to the handguard.
                approach,turned = contact(handle,latch,CHARGE[0]+3)
                pose('left',(CHARGE[0]+3)/FPS,lowered(approach,.09),turned,pinch)
                follow(handle,latch,CHARGE[0]+8,CHARGE[1]+5)
                pose('left',2.88,lowered(approach.lerp(rest,.5),.12),turned.slerp(held['left'][1],.5),pinch)
                pose('left',3.05,lowered(rest,.05))
                pose('left',3.25)
            else:
                pose('left',2.35)
        elif name=='Inspect':
            # Fit the exposed firing hand to the MCX grip and trigger window.
            pos = C @ (Vector((.03311,-.01305,.07878))-ORIGIN)
            q = native(Quaternion((.754389,-.025206,-.031537,-.655185)))
            fitted = {
                'fingerSpread':[-.183,.012,-.090,-.250],
                'fingers':[[-.285,1.477,.227],[.255,1.757,.818],[.465,1.685,.601],[.657,1.318,.550]],
                'thumbBase':[-1.386,-.564,-2.898],
                'thumb':[.015,1.280],
            }
            duration = clips[name]['duration']
            for t in (.18,duration-.18): pose('right',t,pos,q,fitted)
            # Unwrap the fingers outside the guard at the two grip transitions.
            for t in (.045,.135,duration-.135,duration-.045):
                key(hands['right']['wrist'],'location',pos+C @ Vector((.023,-.004,0)),t*FPS)
            pose('left',.10,rest+C @ Vector((-.016,-.016,.005)))
            pose('left',.19,rest+C @ Vector((-.054,-.047,.014)))
            pose('left',.29,rest+C @ Vector((-.096,-.113,.022)),p=opened)
            # Park relative to ready, not the rolling receiver.
            for f,offset in [
                (26,(-.135,-.249,.050)),
                *((f,(-.142,-.299,.076)) for f in (34,45,121,151,171,185)),
                (200,(-.142,-.233,.049)),
            ]:
                scene.frame_set(f)
                ready_to_rig = rig.matrix_basis.inverted()
                wrist('left',f/FPS,ready_to_rig @ (rest+C @ Vector(offset)),
                      ready_to_rig.to_quaternion() @ held['left'][1])
            wrist('left',3.58,rest+C @ Vector((-.108,-.080,.024)))
            pose('left',3.75,rest+C @ Vector((-.064,-.043,.013)),p=opened)
            pose('left',3.90,rest+C @ Vector((-.025,-.017,.004)))
            pose('left',4.05)
        elif name=='Draw':
            pose('left',0,rest+C @ Vector((-.02,-.09,.06)))
            pose('left',.37)
        elif name=='Holster':
            offset = C @ Vector((-.02,-.1,.07))
            pose('left',.08,rest+offset*.5)
            pose('left',.18,rest+offset*.85,p=opened)
            pose('left',.4,rest+offset,p=opened)
        finish(name,(0,) if name=='Draw' else ())
    author_review_hands(root,rig,hands,parts+controls,clips,basis=C,label='MCX',frame_step=1)
    return controls


def bake_export_actions(objects,clips):
    """Export editable BEZIER/CUBIC curves on the LINEAR frame lattice, like M4.

    Runs after the .blend is saved; per-frame LINEAR and CONSTANT curves are kept.
    """
    for obj in objects:
        for track in obj.animation_data.nla_tracks:
            end = clips[track.name]['frames'][1]; frames = range(math.ceil(end)+1)
            curves = list(fcurves(track.strips[0].action))
            for path in {c.data_path for c in curves}:
                group = sorted((c for c in curves if c.data_path==path),key=lambda c:c.array_index)
                if all(p.interpolation in ('LINEAR','CONSTANT') for c in group for p in c.keyframe_points): continue
                values = [[c.evaluate(f) for c in group] for f in frames]
                # Component-wise curves leave the unit sphere between poses; export unit keys.
                if path=='rotation_quaternion': values = [list(Quaternion(r).normalized()) for r in values]
                constant = all(max(r[i] for r in values)-min(r[i] for r in values) < 1e-4 for i in range(len(group)))
                indices = [0,len(values)-1] if constant else range(len(values))
                for i,curve in enumerate(group):
                    curve.keyframe_points.clear(); curve.keyframe_points.add(len(indices))
                    curve.keyframe_points.foreach_set('co',[x for k in indices for x in (min(frames[k],end),values[k][i])])
                    for point in curve.keyframe_points: point.interpolation = 'LINEAR'
                    curve.update()
