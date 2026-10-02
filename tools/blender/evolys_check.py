"""Independent saved-source geometry/animation/export checks, no regeneration.
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend --python-exit-code 1 --python tools/blender/evolys_check.py
"""
import json
import math
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/weapons/fn-evolys-762'
manifest=json.loads((OUT/'manifest.json').read_text());scene=bpy.context.scene
C=Matrix(((1,0,0),(0,0,-1),(0,1,0)));CI=C.inverted()
asset=bpy.data.collections['EVOLYS | authored components']

def sample(name,time):
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data.action=None
            for t in o.animation_data.nla_tracks:t.mute=t.name!=name
    scene.frame_set(int(time*120),subframe=time*120-int(time*120));bpy.context.view_layer.update()

sample('Idle',0);triangles=0
for o in asset.objects:
    if o.type!='MESH':continue
    assert len(o.data.vertices)>0 and len(o.data.polygons)>0,o.name
    assert o.data.uv_layers,o.name+' missing UVs'
    assert all(math.isfinite(x) for v in o.data.vertices for x in v.co),o.name
    o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
assert triangles==manifest['stats']['triangles'],(triangles,manifest['stats'])
for name in ('evolys_surface','evolys_roughness','evolys_normal'):
    im=bpy.data.images[name];assert im.packed_file and tuple(im.size)==(1024,1024)
# Measure mesh boundaries, not just constants repeated in the manifest.
def points(o):return [CI@(o.matrix_world@v.co) for v in o.data.vertices]
sample('Idle',0)
all_points=[p for o in asset.objects if o.type=='MESH' and not o.name.startswith(('pouch_spare','belt')) for p in points(o)]
zlo=min(p.z for p in all_points);zhi=max(p.z for p in all_points)
assert abs((zhi-zlo)-.948)<.002,('948 mm retracted envelope',zhi-zlo)
# The 406 mm barrel must have actual rings at both measurement planes; the
# separate muzzle device is deliberately excluded from this length convention.
hg=bpy.data.objects['handguard_mesh'];ps=points(hg)
for z in (manifest['dimensions']['barrelFace'],manifest['dimensions']['barrelCrown']):
    near=[p for p in ps if abs(p.z-z)<.00025 and abs(p.y-.075)<.009 and abs(p.x)<.009]
    assert len(near)>=8,('barrel endpoint not in geometry',z,len(near))
assert abs(manifest['dimensions']['barrelFace']-manifest['dimensions']['barrelCrown']-.406)<1e-8
# Cross-sections expose actual full-depth triangular vents; no dark decals.
from mathutils.bvhtree import BVHTree
bvh=BVHTree.FromObject(hg,bpy.context.evaluated_depsgraph_get())
for px,py in [(1316,168),(1365,180),(1412,168),(1461,180),(1507,168),(1558,180)]:
    s=.948/(1956-57);z=(805-px)*s;y=.075+(219-py)*s
    origin=hg.matrix_world.inverted()@(C@Vector((-.06,y,z)))
    direction=hg.matrix_world.inverted().to_3x3()@(C@Vector((1,0,0)))
    hit=bvh.ray_cast(origin,direction,.12);assert hit[0] is None,('closed handguard opening',px)
# The folded leaf and support must clear the selected RMR axis.
sight=CI@bpy.data.objects['SOCKET_sight'].matrix_world.translation
assert abs(sight.x)<1e-6
rail_top=.075+(219-123)*(.948/(1956-57))+.002
assert abs(sight.y-rail_top-.768*.0254)<.000002,'RM33 published rail-to-optical-axis datum'
belt=bpy.data.objects['belt_rig'];sample('Fire',0)
start=belt.pose.bones['belt_3'].matrix.translation.copy();sample('Fire',.060)
end=belt.pose.bones['belt_3'].matrix.translation.copy();assert abs((end-start).length-.0127)<.0002
# Exported mechanisms, wrists and shared preview skins select matching tracks.
clips=json.loads(scene['clips']);assert set(clips)=={'Idle','Fire','Last_Shot','Reload_Tactical','Reload_Empty','Inspect','Draw','Holster'}
for name,info in clips.items():
    for k in range(25):
        sample(name,info['duration']*k/24)
        for side,prefix in [('left','L'),('right','R')]:
            control=bpy.data.objects['hand_'+prefix]
            assert all(math.isfinite(v) for v in control.matrix_world.translation)
            arm=bpy.data.objects['EVOLYS_arm_'+side]
            wrist=arm.matrix_world@arm.pose.bones['hand'].matrix
            # Original arm bind hand origin is the wrist; the DCC skin bake
            # follows the same control within interpolation/sampling error.
            assert (wrist.translation-control.matrix_world.translation).length<.006,(name,side,k)
    for o in asset.objects:
        if o.animation_data:assert any(t.name==name for t in o.animation_data.nla_tracks),(o.name,name)
for name in ('Reload_Tactical','Reload_Empty'):
    sample(name,clips[name]['duration']);assert abs(bpy.data.objects['feed_cover'].rotation_quaternion.angle)<.0001
print('EVOLYS_CHECK_OK: saved mesh envelope, barrel endpoints, open vents, packed maps, one-pitch native feed and synchronized DCC wrists/skins')
