"""Independent saved-source geometry/animation/export checks, no regeneration.
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend --python-exit-code 1 --python tools/blender/evolys/check.py
"""
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector, Quaternion
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'assets/weapons/fn-evolys-762'
sys.path.insert(0,str(ROOT/'tools/blender'))
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
import picatinny
bvh=BVHTree.FromObject(hg,bpy.context.evaluated_depsgraph_get())
for px,py in [(1316,168),(1365,180),(1412,168),(1461,180),(1507,168),(1558,180)]:
    s=.948/(1956-57);z=(805-px)*s;y=.075+(219-py)*s
    origin=hg.matrix_world.inverted()@(C@Vector((-.06,y,z)))
    direction=hg.matrix_world.inverted().to_3x3()@(C@Vector((1,0,0)))
    hit=bvh.ray_cast(origin,direction,.12);assert hit[0] is None,('closed handguard opening',px)
# Receiver stays below the rail; the separately removable irons own the axis.
rail_top=.075+(219-123)*(.948/(1956-57))+.002+.0055
assert max(p.y for p in points(bpy.data.objects['receiver_mesh']))<=rail_top+1e-6,'receiver intrudes above the rail contact plane'
# The rear carrier/tube closes the upper pad joint and cheek-to-web seam.
stock_mesh=bpy.data.objects['stock_mesh'];stock_bvh=BVHTree.FromObject(stock_mesh,bpy.context.evaluated_depsgraph_get())
for px,py in [(92,206),(105,238),(190,253),(220,253),(300,256),(380,246)]:
    s=.948/(1956-57);origin=stock_mesh.matrix_world.inverted()@(C@Vector((-.06,.075+(219-py)*s,(805-px)*s)))
    direction=stock_mesh.matrix_world.inverted().to_3x3()@(C@Vector((1,0,0)))
    assert stock_bvh.ray_cast(origin,direction,.12)[0] is not None,('daylight gap in stock carrier',px,py)
# The aim datum is the real rear bore and front post.
sight=CI@bpy.data.objects['SOCKET_sight'].matrix_world.translation
front=CI@bpy.data.objects['SOCKET_front_post'].matrix_world.translation
assert abs(sight.x)<1e-6 and abs(front.x)<1e-6 and abs(front.y-sight.y)<1e-6
assert abs(sight.y-rail_top-.026)<.000002
irons=bpy.data.objects['IRON_sights_mesh']
assert irons.parent==bpy.data.objects['IRON_sights']
assert not any('RMR' in o.name or o.name=='optic' for o in asset.objects)
assert not any(m.name.startswith('10 |') for o in asset.objects if o.type=='MESH' for m in o.data.materials if m)
ps=points(irons)
for z in (sight.z,front.z):
    assert any(abs(p.y-rail_top)<1e-6 and abs(p.z-z)<.012 for p in ps),'iron foot floats above rail'
rear_tree=BVHTree.FromPolygons([irons.matrix_world@v.co for v in irons.data.vertices],[tuple(p.vertices) for p in irons.data.polygons])
for x,y in [(0,0),(.001,0),(-.001,0),(0,.001),(0,-.001)]:
    assert rear_tree.ray_cast(C@Vector((x,sight.y+y,sight.z+.01)),C@Vector((0,0,-1)),.02)[0] is None,'blocked rear aperture'
assert rear_tree.ray_cast(C@Vector((.0013,sight.y,sight.z+.01)),C@Vector((0,0,-1)),.02)[0] is not None,'missing aperture rim'
# Solid centreline through the support/ring overlap, below the clear bore.
for y in (rail_top+.0205,rail_top+.0215,rail_top+.0225):
    assert rear_tree.ray_cast(C@Vector((0,y,sight.z+.01)),C@Vector((0,0,-1)),.02)[0] is not None,'daylight between aperture and pedestal'
assert rear_tree.ray_cast(C@Vector((0,front.y+.0001,front.z+.01)),C@Vector((0,0,-1)),.02)[0] is None,'front tip above axis'
assert rear_tree.ray_cast(C@Vector((0,front.y-.0002,front.z+.01)),C@Vector((0,0,-1)),.02)[0] is not None,'front post below aim datum'
mount=bpy.data.objects['MOUNT_optic']
assert mount.parent==bpy.data.objects['EVOLYS_RIG']
mp=CI@mount.matrix_world.translation
assert abs(mp.x)<1e-6 and abs(mp.y-rail_top)<1e-6 and abs(mp.z-(.105-30*.01005+6*picatinny.PITCH))<1e-6
assert Vector(mount.rotation_euler).length<1e-6,'optic mount orientation'
# Rear seating plane at the barrel crown, distinct from the base hider exit.
muzzle_mount=bpy.data.objects['MOUNT_muzzle']
muzzle=CI@muzzle_mount.matrix_world.translation
assert muzzle_mount.parent==bpy.data.objects['EVOLYS_RIG']
assert (muzzle-Vector((0,.075,manifest['dimensions']['barrelCrown']))).length<1e-6
assert (CI@muzzle_mount.matrix_world.to_3x3()@Vector((0,1,0))-Vector((0,0,-1))).length<1e-6
assert (muzzle_mount.matrix_world.to_scale()-Vector((1,1,1))).length<1e-6
assert bpy.data.objects['MUZZLE_device_mesh'].parent==bpy.data.objects['MUZZLE_device']
assert bpy.data.objects['MUZZLE_device_removed_mesh'].parent==bpy.data.objects['MUZZLE_device_removed']
rail=bpy.data.objects['MOUNT_rail']
lower_y=.075+(219-336)*(.948/1899)
assert (CI@rail.matrix_world.translation-Vector((0,lower_y,-.363725))).length<1e-6
normal=CI@rail.matrix_world.to_3x3()@C@Vector((0,1,0))
assert (normal-Vector((0,1,0))).length<1e-6
# Actual underside teeth and the recoil-key slot, not just a floating mount datum.
for a,b in picatinny.lands(-.392,-.2224,-.363725):
    z=(a+b)/2
    origin=hg.matrix_world.inverted()@(C@Vector((0,lower_y-.01,z)))
    direction=hg.matrix_world.inverted().to_3x3()@(C@Vector((0,1,0)))
    hit=bvh.ray_cast(origin,direction,.02)[0]
    assert hit is not None and abs((CI@(hg.matrix_world@hit)).y-lower_y)<1e-6,'missing lower rail tooth'
for x in (-.00265,.00265):
    for z in (-.363725-.0021,-.363725+.0021):
        origin=hg.matrix_world.inverted()@(C@Vector((x,lower_y-.01,z)))
        hit=bvh.ray_cast(origin,direction,.02)[0]
        assert hit is not None and abs((CI@(hg.matrix_world@hit)).y-(lower_y+picatinny.SLOT_DEPTH))<1e-6,'recoil key is not over a supported rail slot'
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
# Preserve the whole calibrated charging interval, including every held finger
# control, not only its endpoints. Released routes must not retime the grip.
sys.path.insert(0,str(ROOT/'tools/blender'))
from evolys.actions import charging_contact_reference
wrist=bpy.data.objects['hand_L'];duration=clips['Reload_Empty']['duration']
action=next(t for t in wrist.animation_data.nla_tracks if t.name=='Reload_Empty').strips[0].action
reference,contact_curve=charging_contact_reference(action,duration)
sample('Reload_Empty',.82*duration)
fingers=[o for o in asset.objects if o.name.startswith(('L_finger','L_thumb'))]
held={o:(o.location.copy(),o.rotation_quaternion.copy(),o.scale.copy()) for o in fingers}
calibration=json.loads((OUT/'hand-reference.json').read_text())['charging']
q=calibration['quaternion'];expected_q=(C@Quaternion((q[3],*q[:3])).to_matrix()@CI).to_quaternion()
for time in [.82*duration,*[f/120 for f in range(math.ceil(.82*duration*120),math.floor(.88*duration*120)+1)],.88*duration]:
    sample('Reload_Empty',time)
    p=CI@(bpy.data.objects['EVOLYS_RIG'].matrix_world.inverted()@wrist.matrix_world.translation)
    assert abs(p.x-calibration['pos'][0])<2e-7 and abs(p.y-calibration['pos'][1])<2e-7 and abs(p.z+contact_curve.evaluate(time*120))<2e-7,'charging contact trajectory changed'
    assert min((wrist.rotation_quaternion-expected_q).magnitude,(wrist.rotation_quaternion+expected_q).magnitude)<1e-6 and (wrist.scale-Vector((1,1,1))).length<1e-6,'charging wrist orientation/scale changed'
    for obj,(position,rotation,scale) in held.items():
        assert (obj.location-position).length<1e-7 and (obj.rotation_quaternion-rotation).magnitude<1e-6 and (obj.scale-scale).length<1e-7,('charging finger TRS changed',obj.name,time)
bpy.data.actions.remove(reference)
print('EVOLYS_CHARGING_CONTACT_OK: original wrist trajectory and held wrist/finger TRS, .82–.88')
# Load the actual shared authoring products, never proxy boxes. These immutable
# trees stay in weapon-rig space while each moving surface follows its clip.
sample('Idle',0)
rig=bpy.data.objects['EVOLYS_RIG']
import attachment_source
def rig_tree(objects):
    return attachment_source.surface(objects,rig.matrix_world.inverted())
fixed_irons=rig_tree([irons]);rail_tree=rig_tree([bpy.data.objects['receiver_mesh']]);attachments={}
bpy.data.objects['MUZZLE_device_removed'].hide_viewport=False
bpy.context.view_layer.update()
for attachment_id,seat in [('rmr',mount),('acog',mount),('scope',mount),('exps3',mount),('srd762ti',muzzle_mount),('laser',rail)]:
    objects=attachment_source.seat(attachment_id,seat,weapon='evolys')
    meshes=[o for o in objects if o.type=='MESH']
    attachments[attachment_id]=rig_tree(meshes)
    if attachment_id in attachment_source.OPTICS:
        # Clamps straddle the rail-contact plane; test actual rail/foot surfaces.
        assert attachments[attachment_id].overlap(rail_tree),(attachment_id,'no rail contact')
        clash=bool(attachments[attachment_id].overlap(fixed_irons))
        assert clash==(attachment_id=='scope'),(attachment_id,'update evidence-based opticClashes',clash)
    if attachment_id=='srd762ti':
        exit=attachment_source.named(objects,'SOCKET_muzzle')
        position=CI@(rig.matrix_world.inverted()@exit.matrix_world).translation
        assert (position-(muzzle+Vector((0,0,-.236)))).length<1e-6,'mounted can exit'
        can=attachments[attachment_id]
        for obj in (hg,bpy.data.objects['receiver_mesh'],bpy.data.objects['MUZZLE_device_removed_mesh'],irons):
            assert not can.overlap(rig_tree([obj])),(obj.name,'suppressor hits fixed surface')
        # 7.8 mm gauge clears the actual adapter and unchanged shared endcap.
        adapter_tree=rig_tree([bpy.data.objects['MUZZLE_device_removed_mesh']])
        for i in range(33):
            angle=i*math.tau/32;radius=.0039 if i<32 else 0
            origin=C@(position+Vector((radius*math.cos(angle),radius*math.sin(angle),-.001)))
            for tree in (can,adapter_tree):
                assert tree.ray_cast(origin,C@Vector((0,0,1)),.237)[0] is None,'blocked mounted bore'
    for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
for other in (*attachment_source.OPTICS,'laser'):
    assert not attachments['srd762ti'].overlap(attachments[other]),(other,'suppressor slot collision')
# Check all clips on the native 120 Hz lattice, including exact endpoints.
# The stock is rigid (there is no authored fold clip). Preserve its geometry;
# cover/charging/belt and BOTH actual deformed shared review arms are swept.
poses=0;free_poses=0
pouch_surfaces=[bpy.data.objects[n] for n in ('pouch_mesh','pouch_spare_mesh')]
moving=[bpy.data.objects[n] for n in ('feed_cover_mesh','charging_handle_mesh','stock_mesh','belt_mesh')]
hands=[o for o in scene.objects if o.type=='MESH' and o.name.startswith('EVOLYS_') and 'ARMATURE' in {m.type for m in o.modifiers}]
assert hands,'missing actual shared review hands'
# A collision-free attachment is not enough if the support hold floats or enters the pouch.
guard_tree=rig_tree([hg]);pouch_tree=rig_tree([bpy.data.objects['pouch_mesh']])
for obj in hands:
    if not obj.name.startswith('EVOLYS_left_'):continue
    assert not rig_tree([obj]).overlap(pouch_tree),(obj.name,'support hold crosses pouch')
    if not obj.name.endswith('Charcoal_woven_glove_skin'):continue
    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
    try:
        inverse=rig.matrix_world.inverted()
        for finger in range(4):
            ids=[v.index for v in obj.data.vertices if any(g.weight>.5 and obj.vertex_groups[g.group].name==f'finger_{finger}_2' for g in v.groups)]
            gap=min(guard_tree.find_nearest(inverse@evaluated.matrix_world@mesh.vertices[i].co)[3] for i in ids)
            assert gap<.0045,(finger,gap,'support fingertip floats off handguard')
    finally:evaluated.to_mesh_clear()
print('EVOLYS_SUPPORT_HOLD_OK: actual distal glove contact and no Idle pouch intersection')
for name,info in clips.items():
    for frame in range(math.ceil(info['duration']*120)+1):
        time=min(frame/120,info['duration']);sample(name,time);poses+=1
        # Exclude intentional pouch grips and inherited early feed-approach contact.
        free_hand=name in ('Draw','Holster','Inspect') or (name.startswith('Reload_') and (time<=.10*info['duration'] or time>=.90*info['duration']))
        pouch_trees=[]
        if free_hand:
            free_poses+=1
            pouch_trees=[(obj.name,rig_tree([obj])) for obj in pouch_surfaces if min(obj.matrix_world.to_scale())>.5]
        for obj in moving+hands:
            tree=rig_tree([obj])
            if obj in hands:
                for pouch_name,target in pouch_trees:
                    assert not tree.overlap(target),(name,frame,obj.name,pouch_name,'free hand crosses visible pouch')
            for attachment_id,target in attachments.items():
                assert not tree.overlap(target),(name,frame,obj.name,attachment_id,'attachment collision')
            assert not tree.overlap(fixed_irons),(name,frame,obj.name,'iron collision')
print('EVOLYS_FREE_HAND_CLEARANCE_OK:',free_poses,'native free-motion poses; both hands against visible pouch instances')
print(f'EVOLYS_ATTACHMENT_CLEARANCE_OK: {poses} native poses, rmr/acog with irons, scope with irons removed, SRD762Ti and TOR Mini; cover, charging, stock, belt and both deformed hands; bipod N/A (not authored), sprint uses the same rigid mount')
print('EVOLYS_CHECK_OK: mesh envelope, barrel, vents, packed maps, aligned removable irons, closed stock joints, one-pitch native feed, belt/solid clearance, enclosed tail and synchronized DCC wrists/skins')

# Actual shared rail attachment, independent of the optic catalog.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tor_mini.mounts import check_laser_mount
check_laser_mount('evolys')
