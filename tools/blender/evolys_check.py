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
# Red-dot-only loadout: receiver geometry may not protrude above the rail.
assert max(p.y for p in points(bpy.data.objects['receiver_mesh']))<.128,'folded iron geometry remains'
# The rear carrier/tube closes the upper pad joint and cheek-to-web seam.
stock_mesh=bpy.data.objects['stock_mesh'];stock_bvh=BVHTree.FromObject(stock_mesh,bpy.context.evaluated_depsgraph_get())
for px,py in [(92,206),(105,238),(190,253),(220,253),(300,256),(380,246)]:
    s=.948/(1956-57);origin=stock_mesh.matrix_world.inverted()@(C@Vector((-.06,.075+(219-py)*s,(805-px)*s)))
    direction=stock_mesh.matrix_world.inverted().to_3x3()@(C@Vector((1,0,0)))
    assert stock_bvh.ray_cast(origin,direction,.12)[0] is not None,('daylight gap in stock carrier',px,py)
# Published RMR optical-axis datum remains unchanged.
sight=CI@bpy.data.objects['SOCKET_sight'].matrix_world.translation
assert abs(sight.x)<1e-6
rail_top=.075+(219-123)*(.948/(1956-57))+.002
assert abs(sight.y-rail_top-.768*.0254)<.000002,'RM33 published rail-to-optical-axis datum'
belt=bpy.data.objects['belt_rig'];sample('Fire',0)
start=belt.pose.bones['belt_3'].matrix.translation.copy();sample('Fire',.060)
end=belt.pose.bones['belt_3'].matrix.translation.copy();assert abs((end-start).length-.0127)<.0002
# Actual deformed belt triangles must not cross the lid, cloth, receiver,
# fixed feed guides or closed cover at any sampled firing phase.
def world_bvh(o):
    evaluated=o.evaluated_get(bpy.context.evaluated_depsgraph_get());m=evaluated.to_mesh();m.calc_loop_triangles()
    tree=BVHTree.FromPolygons([evaluated.matrix_world@v.co for v in m.vertices],[tuple(t.vertices) for t in m.loop_triangles],all_triangles=True)
    evaluated.to_mesh_clear();return tree
for k in range(13):
    sample('Fire',manifest['clips']['Fire']['duration']*k/12)
    skin=bpy.data.objects['belt_mesh'];skin_bvh=world_bvh(skin)
    for name in ('receiver_mesh','feed_cover_mesh','pouch_mesh'):
        collisions=skin_bvh.overlap(world_bvh(bpy.data.objects[name]))
        assert not collisions,('belt penetrates solid mesh',name,k,len(collisions))
    # The hidden lower rounds stay inside the pouch footprint, not beside it.
    for i in (6,7):
        p=CI@(belt.matrix_world@belt.pose.bones['belt_'+str(i)].matrix.translation)
        assert -.070<p.x<-.048 and -.02<p.y<.035,('belt misses pouch exit',i,k,tuple(p))
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
print('EVOLYS_CHECK_OK: mesh envelope, barrel, vents, packed maps, no irons, closed stock joints, one-pitch native feed, belt/solid clearance, enclosed tail and synchronized DCC wrists/skins')
