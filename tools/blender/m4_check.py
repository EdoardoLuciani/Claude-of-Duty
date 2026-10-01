"""Evaluated M4 source geometry/assembly and complete-clip mechanical checks.
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend --python-exit-code 1 --python tools/blender/m4_check.py
Do not confuse surface contact/support or explicit clearance with factory CAD.
"""
import json
import math
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

scene=bpy.context.scene;rig=bpy.data.objects['M4_RIG']
CI=Matrix(((1,0,0),(0,0,1),(0,-1,0))).to_4x4()
meshes=[o for o in bpy.data.collections['M4A1 | authored components'].objects if o.type=='MESH']
clips=json.loads(scene['clips'])
def pick(prefix):return [o for o in meshes if o.name.startswith(prefix)]
def pose(name,t=0):
    for o in scene.objects:
        if o.animation_data:
            o.animation_data.action=None
            for track in o.animation_data.nla_tracks:track.mute=track.name!=name
    frame=t*120;scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame));bpy.context.view_layer.update()
def geometry(objects):
    verts=[];faces=[];root_inverse=rig.matrix_world.inverted()
    for o in objects:
        matrix=CI@root_inverse@o.matrix_world;offset=len(verts)
        verts.extend(matrix@v.co for v in o.data.vertices)
        # Boolean mouths are concave ngons: BVH's polygon fan can close their
        # holes and report phantom intersections. Use actual rendered tessellation.
        o.data.calc_loop_triangles()
        faces.extend(tuple(offset+i for i in face.vertices) for face in o.data.loop_triangles)
    return verts,faces
def bounds(objects):
    verts,_=geometry(objects)
    return tuple(min(v[i] for v in verts) for i in range(3)),tuple(max(v[i] for v in verts) for i in range(3))
def gap(a,b):return max(max(b[0][i]-a[1][i],a[0][i]-b[1][i]) for i in range(3))
def tree(objects):
    vertices,faces=geometry(objects)
    return BVHTree.FromPolygons(vertices,faces,all_triangles=True,epsilon=.000002)
def attached(a,b):return bool(tree(a).overlap(tree(b)))
def near(a,b,tolerance=.001):assert abs(a-b)<=tolerance,f'{a*1000:.3f} mm != {b*1000:.3f} mm'

stock=pick(('LMT ','SOPMOD ','Buttpad '))
charging=[o for o in meshes if o.parent and o.parent.name=='charging_handle']
rear=pick('MaTech ')
assert stock and charging and rear
pose('Idle')
fixed_bounds={o:bounds([o]) for o in stock+rear}
minimum_stock=math.inf;minimum_rear=math.inf;poses=0
# AABB separation covers containment too. Components are kept separate so the
# storage caps cannot inflate an empty space into a false single stock envelope.
for name,info in clips.items():
    duration=info['duration']
    for frame in range(math.ceil(duration*120)+1):
        pose(name,min(frame/120,duration));poses+=1
        for moving in charging:
            a=bounds([moving])
            for fixed in stock:
                distance=gap(a,fixed_bounds[fixed]);minimum_stock=min(minimum_stock,distance)
                assert distance>=.00045,f'{name}/{frame}: {moving.name} intersects stock/needs .45 mm separation ({distance*1000:.3f} mm)'
            for fixed in rear:
                distance=gap(a,fixed_bounds[fixed]);minimum_rear=min(minimum_rear,distance)
                assert distance>=.00045,f'{name}/{frame}: {moving.name} intersects MaTech/needs .45 mm separation ({distance*1000:.3f} mm)'
print(f'M4_CHARGING_CLEARANCE_OK: {poses} poses, stock {minimum_stock*1000:.3f} mm, rear sight {minimum_rear*1000:.3f} mm')

pose('Idle')
upper=pick('Colt upper forging');lower=pick('Colt lower forging')
fixed_channel=upper+pick(('Receiver end plate','Castle nut','Buffer extension','Upper receiver rail','Gas tube','Chamber extension'))
fixed_trees=[(o.name,tree([o])) for o in fixed_channel]
carrier=[o for o in meshes if o.parent and o.parent.name=='bolt']
head=[o for o in meshes if o.parent and o.parent.name=='bolt_head']
# Sweep both exposed and enclosed mechanism surfaces, not just action endpoints.
checked=set()
for name in ('Fire','Last_Shot','Reload_Empty','Reload_Tactical'):
    for frame in range(math.ceil(clips[name]['duration']*120)+1):
        pose(name,min(frame/120,clips[name]['duration']))
        state=tuple(round(v,8) for obj in (bpy.data.objects['bolt'],bpy.data.objects['bolt_head'],bpy.data.objects['charging_handle']) for v in (*obj.location,*obj.rotation_quaternion))
        if state in checked:continue
        checked.add(state)
        # Fixed geometry is unchanged in rig space; recalculate moving geometry.
        for moving in carrier+head+charging:
            bvh=tree([moving])
            for label,target in fixed_trees:
                assert not bvh.overlap(target),f'{name}/{frame}: {moving.name} intersects {label}'
        handle_tree=tree(charging)
        for moving in carrier+head:
            assert not tree([moving]).overlap(handle_tree),f'{name}/{frame}: {moving.name} intersects the charging handle'
print(f'M4_CHANNEL_CLEARANCE_OK: {len(checked)} distinct full-clip/midframe mechanism poses')

pose('Idle')
assert attached(pick('MaTech rail base'),pick('Upper receiver rail tooth')),'MaTech foot is not seated on a real tooth'
assert attached(pick('MaTech aperture stalk'),pick('MaTech open aperture')),'rear cup has no stalk support'
assert attached(pick('A2 sculpted grip'),lower),'grip is not supported by receiver'
assert attached(pick('SOPMOD rubber buttpad'),pick('LMT SOPMOD body')),'buttpad is not supported'
assert attached(pick('Charging handle stem'),pick('Charging T bow')),'charging bow is not supported by stem'
assert attached(pick('A2 gas boss'),pick('A2 tower leg')),'FSB tower has no gas-boss support'
assert attached(pick('MaTech ranging wedge'),pick('MaTech rail base')),'rear ranging mechanism has no base support'

# Include the fasteners in the handguard exterior, not a shell-only envelope.
guard=pick('RIS II')
lo,hi=bounds(guard);near(hi[2]-lo[2],.31115);near(hi[0]-lo[0],.056642);near(hi[1]-lo[1],.05715)
front=bpy.data.objects['SOCKET_front_post'];sight=bpy.data.objects['SOCKET_sight']
f=CI@front.matrix_world.translation;s=CI@sight.matrix_world.translation
near(f.x,s.x,.00001);near(f.y,s.y,.00001)
rear_tree=tree(rear)
assert rear_tree.ray_cast(Vector((s.x,s.y,s.z+.025)),Vector((0,0,-1)),.045)[0] is None,'rear sight bore is blocked'
face=CI@bpy.data.objects['SOCKET_bolt_face'].matrix_world.translation
crown=CI@bpy.data.objects['SOCKET_barrel_crown'].matrix_world.translation
near((face-crown).length,.3683,.00001)
flash=pick('FH556RC');lo,hi=bounds(flash);near(hi[2]-lo[2],.06604)
# The nominal gauge is clear inside the rail. Allow the disclosed polygon chord
# tolerance (.1 mm diameter), not a silent change to the published 29.210 mm.
guard_tree=tree(guard);radius=.014555
pipe=tree(pick('Gas tube'))
for fixed in guard+pick(('Chamber extension','A2 gas-tube socket','A2 gas boss')):
    assert not pipe.overlap(tree([fixed])),f'gas tube intersects {fixed.name}'
assert not tree(pick('Muzzle thread')).overlap(tree(pick('FH556RC mounting shank'))),'flash-hider counterbore clips nominal 1/2-inch muzzle thread'
for z in (-.430,-.350,-.250,-.155):
    for i in range(32):
        direction=Vector((math.cos(i*math.tau/32),math.sin(i*math.tau/32),0))
        hit,_,_,distance=guard_tree.ray_cast(Vector((0,.075,z)),direction,.06)
        assert hit is None or distance>=radius,f'RIS II 29.210 mm gauge is obstructed at {z}/{i}: {distance}'
print('M4_GEOMETRY_OK: supported assembly, open aligned irons, 368.300 mm barrel / RIS II complete envelope / 66.040 mm flash hider')
