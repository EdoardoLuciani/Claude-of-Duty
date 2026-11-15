"""Blender-owned wrist/finger actions; only the shared arm IK remains runtime-owned."""
import copy
import json
import math

import bpy
from mathutils import Matrix, Quaternion, Vector
from review_hands import author_review_hands

# Game -Z forward -> source +X forward; the MCX's fixed runtime origin offset.
C = Matrix(((0,0,-1),(-1,0,0),(0,1,0)))
CI = C.inverted()
ORIGIN = Vector((0,.07,-.14))
FRAME = Matrix.Translation(ORIGIN) @ CI.to_4x4()
GLTF_TO_SOURCE = Matrix.Rotation(math.pi/2,4,'X')


def eq(e):
    return Quaternion((1,0,0),e[0]) @ Quaternion((0,1,0),e[1]) @ Quaternion((0,0,1),e[2])


def smooth(a,b,t):
    u = min(1,max(0,(t-a)/(b-a)))
    return u*u*u*(u*(u*6-15)+10)


def path(keys,time):
    a,b = next((a,b) for a,b in zip(keys,keys[1:]) if time <= b[0]+1e-8)
    u = min(1,max(0,(time-a[0])/(b[0]-a[0])))
    u = 1-(1-u)**3 if len(b)>3 else smooth(0,1,u)
    return Vector(a[1]).lerp(Vector(b[1]),u), Vector(a[2]).lerp(Vector(b[2]),u)


def author_hands(root,asset,parts,clips):
    scene = bpy.context.scene
    rig,mag,spare,_,handle,*_ = parts
    ref = json.loads((root/'assets/weapons/mcx-virtus/hand-reference.json').read_text())
    # Equip motion is an ordinary native action, like the other weapon adapters.
    equip = {
        'Draw': (.62, [(0,(.05,-.3,.14),(-.85,.5,.55)),(.55*.62,(.01,-.03,.02),(-.1,.06,.06),'out'),(.78*.62,(-.004,.008,-.006),(.04,-.02,-.02)),(.62,(0,0,0),(0,0,0),'out')]),
        'Holster': (.4, [(0,(0,0,0),(0,0,0)),(.25*.4,(.004,.014,-.01),(.08,-.04,-.05)),(.4,(.05,-.32,.15),(-.9,.55,.6),'out')]),
    }
    for name,(duration,keys) in equip.items():
        end = duration*60
        clips[name] = {'frames':[0,end],'duration':duration,'events':[]}
        for obj in parts:
            ad = obj.animation_data
            for track in ad.nla_tracks: track.mute = True
            idle = next(t for t in ad.nla_tracks if t.name=='Idle').strips[0].action
            action = bpy.data.actions.new(name+' | '+obj.name) if obj==rig else idle.copy()
            ad.action = action
            if obj==rig:
                for sample in range(math.ceil(duration*120)+1):
                    t = min(sample/120,duration)
                    pos,rot = path(keys,t)
                    transform = FRAME.inverted() @ Matrix.LocRotScale(pos,eq(rot),Vector((1,1,1))) @ FRAME
                    obj.location = transform.translation
                    obj.rotation_euler = transform.to_euler('XYZ')
                    for prop in ('location','rotation_euler','scale'): obj.keyframe_insert(prop,frame=t*60)
                for layer in action.layers:
                    for strip in layer.strips:
                        for bag in strip.channelbags:
                            for curve in bag.fcurves:
                                for key in curve.keyframe_points: key.interpolation = 'LINEAR'
            track = ad.nla_tracks.new(); track.name = name
            strip = track.strips.new(name,0,action)
            strip.action_frame_start = 0; strip.action_frame_end = end; strip.extrapolation = 'HOLD'
            ad.action = None; track.mute = True

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
    def rotation(obj,q,f):
        rotation = (C @ q.to_matrix() @ CI).to_quaternion()
        rotation.make_compatible(obj.rotation_quaternion)
        obj.rotation_quaternion = rotation
        obj.keyframe_insert('rotation_quaternion',frame=f)
    for name,info in clips.items():
        for obj in parts:
            for track in obj.animation_data.nla_tracks: track.mute = track.name!=name
        for obj in controls:
            obj.animation_data_create(); obj.animation_data.action = bpy.data.actions.new(name+' | '+obj.name)
            for track in obj.animation_data.nla_tracks: track.mute = True
        for sample in range(math.ceil(info['duration']*120)+1):
            t = min(sample/120,info['duration']); f = t*60
            scene.frame_set(math.floor(f),subframe=f%1)
            for side,cs in hands.items():
                data = ref['sides'][side]; grip = ref['grips'][side]
                pos = C @ (Vector(grip['pos'])-ORIGIN)
                q = Quaternion((data['quaternion'][3],*data['quaternion'][:3]))
                pose = copy.deepcopy(data['grip'])
                if side=='left':
                    weight = 0
                    if name.startswith('Reload'):
                        empty = name=='Reload_Empty'
                        charging = empty and t>2
                        part = handle if charging else mag if t<64/60 else spare
                        point = Vector((-.184,.02,-.05) if charging else (-.007,-.16,-.039))
                        finger,back = ((.55,.2,.81),(-.2,.94,-.27)) if charging else ((.1,.72,-.68),(-.86,.34,-.38))
                        z = -Vector(finger).normalized(); y = Vector(back); y = (y-z*y.dot(z)).normalized()
                        contact = Matrix((y.cross(z),y,z)).transposed().to_quaternion()
                        weight = smooth(2.02,2.28,t)*(1-smooth(2.7,3.12,t)) if charging else smooth(.1,.32,t)*(1-smooth(1.95,2.35,t))
                        # Hidden magazine STEP scales never collapse the contact trajectory.
                        part_rotation = part.rotation_euler.to_quaternion()
                        part_matrix = Matrix.LocRotScale(part.location,part_rotation,Vector((1,1,1)))
                        pos = pos.lerp(part_matrix @ (GLTF_TO_SOURCE @ point),weight)
                        target = part_rotation @ (C @ contact.to_matrix() @ CI).to_quaternion()
                        native = (C @ q.to_matrix() @ CI).to_quaternion().slerp(target,weight)
                        q = (CI @ native.to_matrix() @ C).to_quaternion()
                        drop = (.05*smooth(2.7,2.9,t)*(1-smooth(3.12,3.28,t)) + .09*(smooth(1.98,2.04,t)*(1-smooth(2.2,2.28,t))+smooth(2.7,2.85,t)*(1-smooth(3,3.12,t)))) if empty else 0
                        pos -= rig.matrix_local.to_3x3().inverted() @ (C @ Vector((0,drop,0)))
                        weight = smooth(.2,.3,t)*(1-smooth(2.9 if empty else 2.15,3 if empty else 2.25,t))
                    elif name in equip:
                        duration = info['duration']
                        if name=='Draw':
                            offset = Vector((-.02,-.09,.06))*max(0,1-t/(.6*duration))**3
                        else:
                            offset = Vector((-.02,-.1,.07))*(1-(1-t/duration)**3)
                            release = duration*(1-.5**(1/3))
                            weight = smooth(release,release+.1,t)
                        pos += C @ offset
                    other = ref['open'] if name=='Holster' else ref['pinch']
                    if weight:
                        for key in ('fingers','thumb','fingerSpread'):
                            a = pose.get(key,[0]*4); b = other.get(key,a)
                            pose[key] = [[(1-weight)*x+weight*y for x,y in zip(aa,bb)] for aa,bb in zip(a,b)] if key=='fingers' else [(1-weight)*x+weight*y for x,y in zip(a,b)]
                        pose['thumbQuaternion'] = eq(pose.get('thumbBase',(0,-.95,0))).slerp(eq(other.get('thumbBase',(0,-.95,0))),weight)
                wrist = cs['wrist']; wrist.location = pos; wrist.keyframe_insert('location',frame=f); rotation(wrist,q,f)
                for i in range(4):
                    rotation(cs[f'finger_{i}_root'],eq((0,pose.get('fingerSpread',[0]*4)[i],0)),f)
                    for j in range(3): rotation(cs[f'finger_{i}_{j}'],eq((-pose['fingers'][i][j],0,0)),f)
                rotation(cs['thumb_base'],pose.get('thumbQuaternion',eq(pose.get('thumbBase',(0,-.95,0)))),f)
                for j in range(2): rotation(cs[f'thumb_{j}'],eq((-pose['thumb'][j],0,0)),f)
        for obj in controls:
            ad = obj.animation_data; action = ad.action
            for layer in action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for key in curve.keyframe_points: key.interpolation = 'LINEAR'
            track = ad.nla_tracks.new(); track.name = name
            strip = track.strips.new(name,0,action); strip.action_frame_start = 0
            strip.action_frame_end = info['frames'][1]; strip.extrapolation = 'HOLD'
            ad.action = None; track.mute = True
    author_review_hands(root,rig,hands,parts+controls,clips,basis=C,label='MCX',frame_step=.5)
    return controls
