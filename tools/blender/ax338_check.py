"""Independent saved-mesh/action checks, not regeneration from tuning values."""
import json
import math
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
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
# Geometry-derived magazine envelopes must match the editable saved meshes,
# not a separately invented wrist/contact proxy.
for entry in manifest['contactGeometry']['magazine']:
    p=points(entry['part'])
    for i in range(3):
        assert abs(min(v[i] for v in p)-entry['min'][i])<.000001
        assert abs(max(v[i] for v in p)-entry['max'][i])<.000001
p=points('Magazine steel body')
for i,size in enumerate((.034,.105,.104)):
    assert abs(max(v[i] for v in p)-min(v[i] for v in p)-size)<.00001
# Cartridge front/back now fit inside the body instead of projecting 20 mm out.
rounds=points('Visible .338 cartridge');assert min(p.z for p in rounds)>min(p.z for p in points('Magazine steel body'))
assert max(p.z for p in rounds)<max(p.z for p in points('Magazine steel body'))
# Both real extension guides bridge housing/carrier to the butt spacer.
def bounds(name):
    p=points(name);return [(min(v[i] for v in p),max(v[i] for v in p)) for i in range(3)]
def overlap(a,b):return all(min(a[i][1],b[i][1])>max(a[i][0],b[i][0]) for i in range(3))
def touches(a,b):
    def tree(name):
        o=bpy.data.objects[name];return BVHTree.FromPolygons(points(name),[tuple(p.vertices) for p in o.data.polygons])
    return bool(tree(a).overlap(tree(b)))
guides=[o.name for o in bpy.data.objects if o.name.startswith('Butt extension guide')]
assert len(guides)==2
for name,front in zip(sorted(guides),('Stock carrier','Butt adjustment housing')):
    assert overlap(bounds(name),bounds(front)) and overlap(bounds(name),bounds('Butt spacer')),(name,'floating guide/pad assembly')
    assert touches(name,front) and touches(name,'Butt spacer'),(name,'disconnected actual guide surfaces')
assert touches('Pistol grip spine','Tan trigger guard'),'disconnected pistol grip neck'
for suffix in ('','.001'):
    anchor='Panel inboard anchor'+suffix
    assert touches(anchor,'Tan forward grip panel'+suffix) and touches(anchor,'Octagonal slotted forend'),(anchor,'floating panel')
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
print('AX338 saved source: measured barrel/overall/scope, source UV/packed maps, measured magazine/cartridge fit and connected butt guides, true KeySlot, native 60-degree/100 mm bolt and synchronized wrist skins passed')
