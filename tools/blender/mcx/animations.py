"""Six rigid-part clips. Motion is LINEAR at 60 Hz; visibility is CONSTANT.

The stock Actions exporter preserves these samplers directly. NLA tracks only
associate named actions with clips; they are muted during export/rest setup.
"""
import math
import bpy
from mathutils import Vector

FPS = 60

def build_animations(parts):
    rig, mag, spare, bolt, handle, trigger, cover, stock, case, release = parts
    # Rig rest matrices, explicit channels on every clip prevent state leaking
    # when switching from one-shot reloads back to idle in an AnimationMixer.
    bpy.context.view_layer.update()
    rest={o.name:(o.location.copy(),o.rotation_euler.copy(),o.scale.copy()) for o in parts}
    clips={}


    def key(obj,frame,loc=None,rot=None,scale=None):
        base=rest[obj.name]
        obj.location=base[0]+Vector(loc or (0,0,0))
        obj.rotation_euler=Vector(base[1])+Vector(tuple(math.radians(v) for v in (rot or (0,0,0))))
        obj.scale=(scale,)*3 if scale is not None else base[2]
        for prop in ('location','rotation_euler','scale'):obj.keyframe_insert(data_path=prop,frame=frame,group=obj.name)


    def start_clip(name,end):
        clips[name]={'frames':[0,end],'duration':end/60,'loop':name=='Idle','events':[]}
        for obj in parts:
            obj.animation_data_create();obj.animation_data.action=None
            for track in obj.animation_data.nla_tracks:track.mute=True
            action=bpy.data.actions.new(name+' | '+obj.name)
            obj.animation_data.action=action
            hidden=obj in (case,spare)
            for f in (0,end):key(obj,f,scale=0 if hidden else 1)


    def end_clip(name,end):
        for obj in parts:
            ad=obj.animation_data;action=ad.action
            for layer in action.layers:
                for action_strip in layer.strips:
                    for bag in action_strip.channelbags:
                        for curve in bag.fcurves:
                            if curve.data_path == 'scale':
                                for point in curve.keyframe_points: point.interpolation='CONSTANT'
                            else:
                                if obj == case:
                                    for point in curve.keyframe_points:
                                        point.interpolation = 'LINEAR'
                                values = [curve.evaluate(frame) for frame in range(end + 1)]
                                curve.keyframe_points.clear()
                                curve.keyframe_points.add(len(values))
                                curve.keyframe_points.foreach_set('co', [
                                    component for frame, value in enumerate(values)
                                    for component in (frame, value)
                                ])
                                for point in curve.keyframe_points:
                                    point.interpolation = 'LINEAR'
                                curve.update()
            track=ad.nla_tracks.new();track.name=name
            strip=track.strips.new(name,0,action);strip.action_frame_start=0;strip.action_frame_end=end
            strip.extrapolation='NOTHING';strip.blend_type='REPLACE'
            ad.action=None;track.mute=True


    start_clip('Idle',120)
    key(rig,30,(0,0,.0006),(.1,.12,0));key(rig,90,(0,0,-.0006),(-.1,-.12,0))
    end_clip('Idle',120)
    start_clip('Fire',48)
    for f,loc,rot in [(2,(-.014,0,.001),(0,-2.3,-.45)),(5,(-.009,0,.002),(0,-1.4,.2)),(12,(.001,0,0),(0,.15,0)),(20,(0,0,0),(0,0,0))]:key(rig,f,loc,rot)
    for f,x in [(1,0),(4,-.068),(7,-.066),(11,0)]:key(bolt,f,(x,0,0))
    # +Y rotates the hanging blade rearwards (-X), towards the grip.
    for f,a in [(1,0),(2,10),(10,0)]:key(trigger,f,rot=(0,a,0))
    key(case,3,(-.02,-.025,.004),scale=0)
    # Ballistic-looking sampled trajectory. Linear interpolation avoids overshoot.
    for f in range(4,47,2):
        t=(f-4)/60
        key(case,f,(-.022-.48*t,-.038-1.05*t,.006+1.65*t-4.905*t*t),(f*17,f*23,f*11),1)
    key(case,47,(-.37,-.80,-1.20),(800,1100,520),0)
    clips['Fire']['events']=[{'time':.0333,'event':'shot'},{'time':.0667,'event':'casing_eject'}]
    end_clip('Fire',48)
    for name,end,empty_reload in [('Reload_Tactical',156,False),('Reload_Empty',198,True)]:
        start_clip(name,end)
        for f,loc,rot in [(18,(-.025,0,.009),(-20,-8,5)),(42,(-.037,0,-.006),(-27,-9,7)),(95,(-.03,0,-.01),(-22,-7,5)),(122,(-.018,0,0),(-15,-4,3)),(end-12,(0,0,0),(0,0,0))]:key(rig,f,loc,rot)
        for f,loc,rot,s in [(20,(0,0,0),(0,0,0),1),(29,(.003,0,-.022),(0,3,0),1),(43,(.012,-.015,-.12),(8,12,-4),1),(61,(.045,-.09,-.30),(24,30,-18),1),(63,(.05,-.11,-.37),(30,37,-20),0),(end-2,(0,0,0),(0,0,0),0)]:key(mag,f,loc,rot,s)
        for f,loc,rot,s in [(62,(.015,-.06,-.35),(15,-18,-10),0),(64,(.015,-.06,-.29),(15,-18,-10),1),(83,(.008,-.025,-.15),(8,-12,-5),1),(102,(.001,0,-.034),(0,-2,0),1),(111,(0,0,.004),(0,0,0),1),(117,(0,0,0),(0,0,0),1),(end-1,(0,0,0),(0,0,0),1)]:key(spare,f,loc,rot,s)
        # Swap identical meshes on the final frame, avoiding duplicate coplanar mags.
        key(mag,end-1,scale=0)
        if empty_reload:
            for f,x in [(0,-.068),(129,-.068),(145,-.075),(155,-.075),(161,0)]:key(bolt,f,(x,0,0))
            for f,x in [(129,0),(145,-.075),(151,-.075),(157,0)]:key(handle,f,(x,0,0))
        clips[name]['events']=[{'time':29/60,'event':'magazine_out'},{'time':111/60,'event':'magazine_in'}]
        if empty_reload:clips[name]['events'].append({'time':161/60,'event':'bolt_forward'})
        end_clip(name,end)
    start_clip('Inspect',240)
    for f,loc,rot in [(36,(-.025,0,.03),(-34,-12,8)),(88,(-.025,0,.03),(-34,-12,8)),(137,(-.015,0,.038),(34,-8,-12)),(188,(-.015,0,.038),(34,-8,-12)),(228,(0,0,0),(0,0,0))]:key(rig,f,loc,rot)
    end_clip('Inspect',240)
    start_clip('Stock_Fold',120)
    for f,a in [(10,0),(40,-165),(78,-165),(112,0)]:key(stock,f,rot=(0,0,a))
    end_clip('Stock_Fold',120)

    return rest, clips

def select_clip(parts, clips, name, frame=0):
    scene = bpy.context.scene
    for obj in parts:
        for track in obj.animation_data.nla_tracks:
            track.mute = track.name != name
    scene.frame_start = 0
    scene.frame_end = clips[name]["frames"][1]
    scene.frame_set(frame)

def restore_rest(parts, rest):
    for obj in parts:
        for track in obj.animation_data.nla_tracks:
            track.mute = True
        obj.animation_data.action = None
        obj.location, obj.rotation_euler, obj.scale = rest[obj.name]
    bpy.context.view_layer.update()
