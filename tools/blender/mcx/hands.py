"""MCX wrist/finger and equip actions; only the shared arm IK remains runtime-owned.
Sparse BEZIER poses like the other weapons; contact windows follow the moving part.
"""
import json
import math

import bpy
from mathutils import Matrix, Quaternion, Vector
from review_hands import author_review_hands

# Game -Z forward -> source +X forward; the runtime places the source origin here.
C = Matrix(((0,0,-1),(-1,0,0),(0,1,0)))
CI = C.inverted()
ORIGIN = Vector((0,.07,-.14))
FRAME = Matrix.Translation(ORIGIN) @ CI.to_4x4()
GLTF_TO_SOURCE = Matrix.Rotation(math.pi/2,4,'X')
FPS = 60


def eq(e):
    return Quaternion((1,0,0),e[0]) @ Quaternion((0,1,0),e[1]) @ Quaternion((0,0,1),e[2])


def native(q):
    return (C @ q.to_matrix() @ CI).to_quaternion()


def basis(finger,back):
    z = -Vector(finger).normalized(); y = Vector(back); y = (y-z*y.dot(z)).normalized()
    return Matrix((y.cross(z),y,z)).transposed().to_quaternion()


def author_hands(root,asset,parts,clips):
    scene = bpy.context.scene
    rig,mag,spare,_,handle,*_ = parts
    ref = json.loads((root/'assets/weapons/mcx-virtus/hand-reference.json').read_text())
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
    def game(pos): return C @ (Vector(pos)-ORIGIN)
    def held(side): return game(ref['grips'][side]['pos']),native(Quaternion((ref['sides'][side]['quaternion'][3],*ref['sides'][side]['quaternion'][:3])))
    def key(obj,prop,value,f):
        if prop=='rotation_quaternion': value.make_compatible(obj.rotation_quaternion)
        setattr(obj,prop,value); obj.keyframe_insert(prop,frame=f)
    def pose(side,t,pos=None,q=None,p=None):
        cs = hands[side]; f = t*FPS; rest_pos,rest_q = held(side); p = p or grip[side]
        key(cs['wrist'],'location',pos if pos is not None else rest_pos,f)
        key(cs['wrist'],'rotation_quaternion',q if q is not None else rest_q,f)
        for i in range(4):
            key(cs[f'finger_{i}_root'],'rotation_quaternion',native(eq((0,p['fingerSpread'][i],0))),f)
            for j in range(3): key(cs[f'finger_{i}_{j}'],'rotation_quaternion',native(eq((-p['fingers'][i][j],0,0))),f)
        key(cs['thumb_base'],'rotation_quaternion',native(eq(p['thumbBase'])),f)
        for j in range(2): key(cs[f'thumb_{j}'],'rotation_quaternion',native(eq((-p['thumb'][j],0,0))),f)
    # Rigid contact on a moving part. Hidden-magazine STEP scales never collapse it.
    magazine = (Vector((-.007,-.16,-.039)),basis((.1,.72,-.68),(-.86,.34,-.38)))
    latch = (Vector((-.184,.02,-.05)),basis((.55,.2,.81),(-.2,.94,-.27)))
    def contact(part,grasp,frame):
        scene.frame_set(math.floor(frame),subframe=frame%1)
        rotation = part.rotation_euler.to_quaternion()
        return Matrix.LocRotScale(part.location,rotation,Vector((1,1,1))) @ (GLTF_TO_SOURCE @ grasp[0]),rotation @ native(grasp[1])
    def follow(part,grasp,first,last):
        for f in range(first,last+1):
            pos,q = contact(part,grasp,f); pose('left',f/FPS,pos,q,pinch)
    def lowered(pos,amount): return pos+C @ Vector((0,-amount,0))

    def begin(name):
        for obj in parts:
            for track in obj.animation_data.nla_tracks: track.mute = track.name!=name
        for obj in controls:
            obj.animation_data_create(); obj.animation_data.action = bpy.data.actions.new(name+' | '+obj.name)
            for track in obj.animation_data.nla_tracks: track.mute = True
        for side in hands: pose(side,0); pose(side,clips[name]['duration'])
    def interpolate(action,out):
        # BEZIER poses; `out` frames start a cubic ease-out (fast leave, soft arrival).
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for point in curve.keyframe_points:
                            eased = any(abs(point.co.x-f) < 1e-3 for f in out)
                            point.interpolation = 'CUBIC' if eased else 'BEZIER'
                            if eased: point.easing = 'EASE_OUT'
                            point.handle_left_type = 'AUTO_CLAMPED'; point.handle_right_type = 'AUTO_CLAMPED'
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
        rest,_ = held('left')
        if name.startswith('Reload'):
            empty = name=='Reload_Empty'
            # Reach the magazine, ride it out and the spare in, then release.
            pose('left',.1)
            follow(mag,magazine,20,61)
            follow(spare,magazine,64,117)
            if empty:
                # Stay below the optic until the latch clears it rearward, ride
                # the rest of its stroke, then return low to the handguard.
                approach,_ = contact(handle,latch,132)
                pose('left',2.2,lowered(approach,.09),None,pinch)
                follow(handle,latch,137,162)
                pose('left',2.88,lowered(approach.lerp(rest,.5),.12),None,pinch)
                pose('left',3.05,lowered(rest,.05))
                pose('left',3.25)
            else:
                pose('left',2.35)
        elif name=='Draw':
            pose('left',0,rest+C @ Vector((-.02,-.09,.06)))
            pose('left',.37)
        elif name=='Holster':
            offset = C @ Vector((-.02,-.1,.07))
            pose('left',.08,rest+offset*.5)
            pose('left',.18,rest+offset*.85,None,opened)
            pose('left',.4,rest+offset,None,opened)
        finish(name,(0,) if name=='Draw' else ())
    author_review_hands(root,rig,hands,parts+controls,clips,basis=C,label='MCX',frame_step=.5)
    return controls


def bake_export_actions(rig,controls,clips):
    """Export the editable BEZIER poses on the LINEAR frame lattice, like M4.

    Runs after the .blend is saved. Mechanism clips are already per-frame
    LINEAR; only hand controls and the rig's equip actions are baked here.
    """
    for obj in [rig,*controls]:
        for track in obj.animation_data.nla_tracks:
            if obj==rig and track.name not in ('Draw','Holster'): continue
            end = clips[track.name]['frames'][1]; frames = range(math.ceil(end)+1)
            for layer in track.strips[0].action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for path in ('location','rotation_quaternion','rotation_euler','scale'):
                            curves = sorted((c for c in bag.fcurves if c.data_path==path),key=lambda c:c.array_index)
                            if not curves: continue
                            values = [[c.evaluate(f) for c in curves] for f in frames]
                            constant = all(max(r[i] for r in values)-min(r[i] for r in values) < 1e-4 for i in range(len(curves)))
                            indices = [0,len(values)-1] if constant else range(len(values))
                            for i,curve in enumerate(curves):
                                curve.keyframe_points.clear(); curve.keyframe_points.add(len(indices))
                                curve.keyframe_points.foreach_set('co',[x for k in indices for x in (min(frames[k],end),values[k][i])])
                                for point in curve.keyframe_points: point.interpolation = 'LINEAR'
                                curve.update()
