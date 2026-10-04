"""MPX native mechanisms and shared wrist/finger controls at 120 Hz.
Game recoil remains reactive. Tactical magazines are retained; only empties drop.
Source stays +X forward. Runtime normalizes the GLB basis once, including curves.
"""
import copy
import json
import math
import bpy
from mathutils import Vector, Quaternion, Matrix
from evolys_actions import author_review_hands

C = Matrix(((0, 0, -1), (-1, 0, 0), (0, 1, 0)))
CI = C.inverted()
FPS = 120

def xyz(v): return C @ Vector(v)
def quat(q): return (C @ q.to_matrix() @ CI).to_quaternion()
def eq(e): return Quaternion((1, 0, 0), e[0]) @ Quaternion((0, 1, 0), e[1]) @ Quaternion((0, 0, 1), e[2])

def author_actions(root, asset, rig, parts, mag, spare, bolt, trigger, release, mag_catch, rounds):
    scene = bpy.context.scene
    ref = json.loads((root / 'assets/weapons/sig-mpx/hand-reference.json').read_text())
    controls = []; hands = {}; clips = {}
    def control(name):
        o = bpy.data.objects.new(name, None); asset.objects.link(o); o.parent = rig
        o.rotation_mode = 'QUATERNION'; o.empty_display_size = .004; controls.append(o)
        return o
    for side, prefix in [('left', 'L'), ('right', 'R')]:
        cs = {'wrist': control('hand_' + prefix)}
        for i in range(4):
            cs[f'finger_{i}_root'] = control(f'{prefix}_finger_{i}_root')
            for j in range(3): cs[f'finger_{i}_{j}'] = control(f'{prefix}_finger_{i}_{j}')
        for name in ('thumb_base', 'thumb_0', 'thumb_1'): cs[name] = control(prefix + '_' + name)
        hands[side] = cs
    for o in parts: o.rotation_mode = 'QUATERNION'
    rest = {o: (o.location.copy(), o.rotation_quaternion.copy(), o.scale.copy()) for o in parts}
    all_parts = parts + controls
    def key(o, time, loc=(0, 0, 0), rot=(0, 0, 0), scale=1):
        o.location = rest[o][0] + xyz(loc)
        o.rotation_quaternion = rest[o][1] @ quat(eq(tuple(math.radians(a) for a in rot)))
        o.scale = (scale,) * 3
        for prop in ('location', 'rotation_quaternion', 'scale'): o.keyframe_insert(prop, frame=time * FPS, group=o.name)
    def pose(side, time, pos=None, q=None, p=None):
        data = ref['sides'][side]; cs = hands[side]; f = time * FPS
        wrist = cs['wrist']; wrist.location = xyz(pos if pos is not None else ref['grips'][side]['pos'])
        wrist.rotation_quaternion = quat(q if q is not None else Quaternion((data['quaternion'][3], *data['quaternion'][:3])))
        for prop in ('location', 'rotation_quaternion'): wrist.keyframe_insert(prop, frame=f)
        p = p if p is not None else data['grip']
        for i in range(4):
            o = cs[f'finger_{i}_root']; o.rotation_quaternion = quat(eq((0, p['fingerSpread'][i], 0))); o.keyframe_insert('rotation_quaternion', frame=f)
            for j in range(3):
                o = cs[f'finger_{i}_{j}']; o.rotation_quaternion = quat(eq((-p['fingers'][i][j], 0, 0))); o.keyframe_insert('rotation_quaternion', frame=f)
        o = cs['thumb_base']; o.rotation_quaternion = quat(p.get('thumbQuaternion', eq(p['thumbBase'])))
        o.rotation_quaternion.make_compatible(quat(eq(data['grip']['thumbBase']))); o.keyframe_insert('rotation_quaternion', frame=f)
        for j in range(2):
            o = cs[f'thumb_{j}']; o.rotation_quaternion = quat(eq((-p['thumb'][j], 0, 0))); o.keyframe_insert('rotation_quaternion', frame=f)
    def relaxed(side):
        p = copy.deepcopy(ref['sides'][side]['grip']); p['fingers'] = [[.15, .25, .18], [.20, .30, .20], [.25, .32, .24], [.32, .36, .27]]; p['thumb'] = [.12, .20]
        return p
    def indexed():
        return ref['sides']['right']['indexed']
    def contact(name, time, pos=None, q=None):
        data = ref[name]; pose('left', time, pos if pos is not None else data['pos'], q or Quaternion((data['quaternion'][3], *data['quaternion'][:3])), data['pose'])
    def magazine_pose(k, out):
        p = copy.deepcopy(ref['magazine']['pose'])
        a = max(0, min(1, (k-(out-.05))/.015)) if k < out else max(0, 1-(k-out)/.035)
        a = a*a*(3-2*a)
        other = ref['magazineRelease']['pose']
        p['thumbQuaternion'] = eq(p['thumbBase']).slerp(eq(other['thumbBase']), a)
        p['thumb'] = [(1-a)*x+a*y for x,y in zip(p['thumb'],other['thumb'])]
        return p
    def free_left_path(keys):
        # Body-space release/approach, not a hand sliding with the weapon rig.
        for f in range(math.ceil(keys[0][0]*FPS), math.floor(keys[-1][0]*FPS)+1):
            t = f/FPS
            a,b = next((a,b) for a,b in zip(keys,keys[1:]) if a[0] <= t <= b[0]+1e-6)
            u = (t-a[0])/(b[0]-a[0]); u = u*u*(3-2*u)
            scene.frame_set(f)
            gm = CI.to_4x4() @ rig.matrix_local @ C.to_4x4()
            pos = Vector(a[1]).lerp(Vector(b[1]),u)
            q = a[2].slerp(b[2],u)
            p = copy.deepcopy(a[3])
            p['fingers'] = [[(1-u)*x+u*y for x,y in zip(xa,xb)] for xa,xb in zip(a[3]['fingers'],b[3]['fingers'])]
            p['thumb'] = [(1-u)*x+u*y for x,y in zip(a[3]['thumb'],b[3]['thumb'])]
            p['thumbQuaternion'] = eq(a[3]['thumbBase']).slerp(eq(b[3]['thumbBase']),u)
            p['fingerSpread'] = [(1-u)*x+u*y for x,y in zip(a[3]['fingerSpread'],b[3]['fingerSpread'])]
            pose('left',t,gm.inverted() @ pos,gm.to_quaternion().inverted() @ q,p)
    def begin(name, duration):
        clips[name] = {'frames': [0, duration * FPS], 'duration': duration, 'loop': name == 'Idle', 'events': []}
        for o in all_parts:
            o.animation_data_create(); o.animation_data.action = None
            for t in o.animation_data.nla_tracks: t.mute = True
            o.animation_data.action = bpy.data.actions.new(name + ' | ' + o.name)
        for o in parts:
            key(o, 0, scale=0 if o == spare else 1); key(o, duration, scale=0 if o == spare else 1)
        for side in hands: pose(side, 0); pose(side, duration)
    def finish(name):
        for o in all_parts:
            ad = o.animation_data; action = ad.action
            for layer in action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for point in curve.keyframe_points:
                                point.interpolation = 'CONSTANT' if curve.data_path == 'scale' else 'BEZIER'
                                point.handle_left_type = 'AUTO_CLAMPED'; point.handle_right_type = 'AUTO_CLAMPED'
            track = ad.nla_tracks.new(); track.name = name; strip = track.strips.new(name, 0, action)
            strip.action_frame_start = 0; strip.action_frame_end = math.ceil(clips[name]['frames'][1]); strip.extrapolation = 'HOLD'; strip.blend_type = 'REPLACE'
            ad.action = None; track.mute = True
    begin('Idle', 2); finish('Idle')
    duration = 60 / 950
    for name, locked in [('Fire', False), ('Last_Shot', True)]:
        begin(name, duration)
        for t, z in [(0, 0), (.014, .038), (.025, .038), (.045, .038 if locked else 0), (duration, .038 if locked else 0)]: key(bolt, t, (0, 0, z))
        for t, angle in [(0, 0), (.006, -9), (.025, -9), (.050, 0)]: key(trigger, t, rot=(angle, 0, 0))
        p = copy.deepcopy(ref['sides']['right']['grip']); p['fingers'][0] = [a + .035 for a in p['fingers'][0]]
        pose('right', .006, p=p); pose('right', .025, p=p); pose('right', .050)
        # Non-reciprocating charging handle remains still. Only the live casing
        # pool emits a case; there is deliberately no exported spent-case mesh.
        if locked: key(rounds, .025, scale=0); key(rounds, duration, scale=0)
        clips[name]['events'] = [{'time': .025, 'event': 'review_casing_eject'}]; finish(name)
    for name, d, empty in [('Reload_Tactical', 1.85, False), ('Reload_Empty', 2.5, True)]:
        begin(name, d)
        out = .20; clear = .32 if empty else .45; appear = .44 if empty else .51; insert = .68 if empty else .78
        # Bore-origin MPX sits lower than the old thumb-origin SMG. Present the
        # well at chest height and away from the eye so insertion is on screen.
        for k, loc, rot in [(.12, (.01, .09, -.08), (-6, 14, 20)), (.48, (.015, .19, -.12), (-6, 17, 23)), (.75, (.01, .17, -.10), (-6, 14, 20)), (.97, (0, 0, 0), (0, 0, 0))]: key(rig, k*d, loc, rot)
        for k, loc, s in [(0, (0, 0, 0), 1), (out, (0, 0, 0), 1), (out+.025, (0, -.030, 0), 1), (clear-.015, (-.01, -.24, .05), 1), (clear, (-.01, -.29, .06), 0), (1, (0, 0, 0), 1)]: key(mag, k*d, loc, scale=s)
        for k, loc, s in [(0, (-.01, -.29, .06), 0), (appear, (-.01, -.29, .06), 1), (insert-.13, (0, -.14, .02), 1), (insert-.04, (0, -.035, 0), 1), (insert, (0, 0, 0), 1), (.999, (0, 0, 0), 1), (1, (0, 0, 0), 0)]: key(spare, k*d, loc, scale=s)
        for k in (.06, .36, .60, .94): pose('right', k*d, p=indexed())
        for k,s in [(0,0),(out-.05,0),(out-.025,1),(out,1),(out+.035,0),(1,0)]: key(mag_catch,k*d,(.0015*s,0,0))
        if empty: key(rounds,0,scale=0)
        clips[name]['magazineReleaseWindow'] = [(out-.025)*d,out*d]
        pose('left', .07*d, [-.09, -.07, -.16], p=relaxed('left'))
        contact('magazine', (out-.05)*d)
        removed = Vector(ref['magazine']['pos']) + Vector((-.01, -.29, .06))
        # Tactical: glove carries the partial magazine down into the pouch.
        # Empty: release the empty at the drop beat, then fetch a fresh one.
        pose('left', clear*d, removed, p=relaxed('left') if empty else ref['magazine']['pose'], q=Quaternion((ref['magazine']['quaternion'][3], *ref['magazine']['quaternion'][:3])))
        contact('magazine', appear*d, removed); contact('magazine', (insert+.025)*d)
        for first, last, part in [(out-.05, clear-.016, mag), (appear, insert+.025, spare)]:
            for f in range(math.ceil(first*d*FPS), math.floor(last*d*FPS)+1):
                scene.frame_set(f)
                pm = Matrix.LocRotScale(part.location, part.rotation_quaternion, Vector((1, 1, 1)))
                gm = CI.to_4x4() @ pm @ C.to_4x4()
                pose('left', f/FPS, gm @ Vector(ref['magazine']['pos']), gm.to_quaternion() @ Quaternion((ref['magazine']['quaternion'][3], *ref['magazine']['quaternion'][:3])), magazine_pose(f/(d*FPS),out) if part == mag else ref['magazine']['pose'])
        pose('left', (insert+.06)*d, [-.10, -.15, -.085], p=relaxed('left'))
        if empty:
            for k, z in [(0, .038), (.835, .038), (.865, 0), (1, 0)]: key(bolt, k*d, (0, 0, z))
            for k, angle in [(0, 0), (.80, 0), (.84, -9), (.875, 0), (1, 0)]: key(release, k*d, rot=(0, 0, angle))
            pose('left', .79*d, [-.09, -.12, .006], p=relaxed('left'))
            rm = Matrix.LocRotScale(rest[release][0],rest[release][1],Vector((1,1,1)))
            pad = xyz(ref['boltRelease']['thumb'])
            for f in range(math.ceil(.815*d*FPS),math.floor(.865*d*FPS)+1):
                scene.frame_set(f)
                delta = release.matrix_local @ rm.inverted()
                shift = CI @ (delta @ pad-pad)
                contact('boltRelease',f/FPS,Vector(ref['boltRelease']['pos'])+shift)
            clips[name]['boltContactWindow'] = [math.ceil(.815*d*FPS)/FPS,math.floor(.865*d*FPS)/FPS]
            pose('left', .895*d, [-.10, -.075, -.055], p=relaxed('left'))
            clips[name]['events'].append({'time': .865*d, 'event': 'boltrelease'})
        pose('left', .96*d)
        clips[name]['magazineClearTime'] = clear*d; clips[name]['magazineInsertTime'] = insert*d
        clips[name]['contactWindows'] = [[(out-.05)*d, (clear-.016)*d, 'magazine'], [appear*d, (insert+.025)*d, 'magazine_spare']]
        clips[name]['events'] += [{'time': .02*d, 'event': 'start'}, {'time': out*d, 'event': 'magout'}, {'time': insert*d, 'event': 'magin'}, {'time': d-.0001, 'event': 'end'}]
        if empty: clips[name]['events'].append({'time': clear*d, 'event': 'magdrop'})
        clips[name]['events'].sort(key=lambda e: e['time']); finish(name)
    begin('Inspect', 2.9)
    for t, loc, rot in [(.40, (-.10, .035, -.10), (-4, -75, 8)), (1.0, (-.10, .035, -.10), (-4, -75, 8)), (1.65, (-.10, .035, -.10), (4, 75, -8)), (2.25, (-.10, .035, -.10), (4, 75, -8)), (2.78, (0, 0, 0), (0, 0, 0))]: key(rig, t, loc, rot)
    for t in (.18, .75, 1.5, 2.5): pose('right', t, p=indexed())
    # A two-handed roll: support contact is maintained throughout, including
    # the return. There is no floating palm or rail-crossing regrip.
    clips['Inspect']['events'] = [{'time': 2.8999, 'event': 'end'}]; finish('Inspect')
    for name, d, drawing in [('Draw', .52, True), ('Holster', .34, False)]:
        begin(name, d)
        for k,a in ([(0,1),(.25,.75),(.70,.12),(.86,0),(1,0)] if drawing else [(0,0),(.15,.08),(.65,.75),(1,1)]):
            key(rig,k*d,(.11*a,-.38*a,.12*a),(-44*a,42*a,36*a))
            pose('right',k*d,p=indexed() if a > .02 else None)
        g = ref['grips']['left']['pos']; gp = ref['sides']['left']['grip']
        gq = Quaternion((ref['sides']['left']['quaternion'][3],*ref['sides']['left']['quaternion'][:3]))
        r = ref['restLeft']; rq = Quaternion((r['quaternion'][3],*r['quaternion'][:3]))
        approach = list(Vector(g)+Vector((-.035,-.035,.05)))
        keys = [(0,r['pos'],rq,r['pose']),(.30*d,r['pos'],rq,r['pose']),(.70*d,approach,gq,r['pose']),(.90*d,g,gq,r['pose']),(.98*d,g,gq,gp),(d,g,gq,gp)] if drawing else [(0,g,gq,gp),(.12*d,g,gq,gp),(.35*d,approach,gq,r['pose']),(.70*d,r['pos'],rq,r['pose']),(d,r['pos'],rq,r['pose'])]
        free_left_path(keys)
        clips[name]['events'] = [{'time': d-.0001, 'event': 'end'}]; finish(name)
    author_review_hands(root, rig, hands, all_parts, clips, basis=C, label='MPX')
    # Restore an invertible canonical pose before exporting static children.
    for o, (pos, q, scale) in rest.items():
        o.location = pos; o.rotation_quaternion = q; o.scale = scale
    return clips
