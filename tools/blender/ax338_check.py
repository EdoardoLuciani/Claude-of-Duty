"""Independent saved-mesh/action checks, not regeneration from tuning values."""
import json
import math
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
ROOT=Path(__file__).resolve().parents[2];CI=Matrix(((1,0,0),(0,0,-1),(0,1,0))).inverted()
scene=bpy.context.scene;rig=bpy.data.objects['AX338_RIG']
manifest=json.loads((ROOT/'assets/weapons/ax338/manifest.json').read_text())
def select(clip,time=0):
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data.action=None
            for t in o.animation_data.nla_tracks:t.mute=t.name!=clip
    frame=time*120;scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()
def points(name):
    o=bpy.data.objects[name];return [CI@(o.matrix_world@v.co) for v in o.data.vertices]
select('Idle')
barrel=points('27 inch barrel');z=[p.z for p in barrel]
assert abs(max(z)-min(z)-.6858)<.00001,(min(z),max(z))
all_points=[]
for o in bpy.data.collections['AX338 | authored components'].objects:
    if o.type=='MESH' and o.parent and o.parent.name not in ('magazine_spare','magazine_spare_round'):
        all_points.extend(CI@(o.matrix_world@v.co) for v in o.data.vertices)
z=[p.z for p in all_points];assert abs(max(z)-min(z)-1.250)<.00001,(min(z),max(z))
scope=points('PM II scope housing');z=[p.z for p in scope]
assert abs(max(z)-min(z)-.417)<.00001
for o in bpy.data.collections['AX338 | authored components'].objects:
    if o.type=='MESH':assert o.data.uv_layers and o.data.polygons,'Missing source UV/geometry: '+o.name
assert all(im.packed_file for im in bpy.data.images if im.name.startswith('ax338_'))
# A ray through a known slot must pass through the physical forend wall.
tube=bpy.data.objects['Octagonal slotted forend'];inverse=tube.matrix_world.inverted()
origin=inverse@Vector((-.050,.200,.064));direction=inverse.to_3x3()@Vector((1,0,0))
# Blender coordinates above: game -Z forward is Blender +Y.
hit,*_=tube.ray_cast(origin,direction,distance=.1)
assert not hit,'KeySlot is filled; a dark surface is not a true opening'
bolt=bpy.data.objects['bolt'];rest=bolt.location.copy();restq=bolt.rotation_quaternion.copy()
select('Bolt_Cycle',.22*1.1)
assert abs((CI@(bolt.location-rest)).z-.100)<.00001
assert abs(bolt.rotation_quaternion.angle- math.pi/3)<.00001
# Finger/wrist authored actions, not runtime-only procedural clip fallback.
for name,info in manifest['clips'].items():
    assert any(t.name==name for t in rig.animation_data.nla_tracks)
    for t in (0,info['duration']*.25,info['duration']*.5,info['duration']*.75,info['duration']):
        select(name,t)
        for prefix in ('L','R'):
            hand=bpy.data.objects['hand_'+prefix]
            assert all(math.isfinite(v) for v in hand.matrix_world.translation)
        # The preview arm skin and exported wrist control share the same datum.
        for side,prefix in [('left','L'),('right','R')]:
            arm=bpy.data.objects['AX338_arm_'+side]
            wrist=arm.matrix_world@arm.pose.bones['hand'].matrix
            target=bpy.data.objects['hand_'+prefix].matrix_world.translation
            assert (wrist.translation-target).length<.0003,(name,t,side,(wrist.translation-target).length)
select('Idle')
assert (bolt.location-rest).length<.00001 and bolt.rotation_quaternion.angle<.00001
print('AX338 saved source: measured barrel/overall/scope, source UV/packed maps, true KeySlot, native 60-degree/100 mm bolt and synchronized wrist skins passed')
