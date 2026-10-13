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
def geometry(objects,evaluated=False):
    verts=[];faces=[];root_inverse=rig.matrix_world.inverted()
    for o in objects:
        ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get()) if evaluated else None
        mesh=ev.to_mesh() if ev else o.data
        matrix=CI@root_inverse@o.matrix_world;offset=len(verts)
        verts.extend(matrix@v.co for v in mesh.vertices)
        # Boolean mouths are concave ngons: BVH's polygon fan can close their
        # holes and report phantom intersections. Use actual rendered tessellation.
        mesh.calc_loop_triangles()
        faces.extend(tuple(offset+i for i in face.vertices) for face in mesh.loop_triangles)
        if ev:ev.to_mesh_clear()
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

# Actual deformed glove/sleeve surfaces, not only the wrist/control origin.
# Include arrival, pull, release and return, at keys and half-frame poses.
pose('Idle');stock_tree=tree(stock)
hands=[o for o in bpy.data.collections['M4 | authored hands (shared appearance)'].objects if o.type=='MESH' and o.name.startswith('M4_left_')]
assert len(hands)==5,'shared left-arm review skins'
hand_poses=0
for frame in range(math.floor(.75*2.9*240),math.ceil(2.9*240)+1):
    pose('Reload_Empty',min(frame/240,2.9));hand_poses+=1
    vertices,faces=geometry(hands,True)
    hand_tree=BVHTree.FromPolygons(vertices,faces,all_triangles=True)
    assert not hand_tree.overlap(stock_tree),f'Reload_Empty/{frame/240:.4f}: deformed charging hand/sleeve intersects stock'
print(f'M4_HAND_STOCK_CLEARANCE_OK: {hand_poses} arrival/pull/release/return poses, actual shared review skins')

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
assert attached(pick('A2 gas boss'),pick('A2 tower casting')),'FSB tower has no gas-boss support'
assert attached(pick('Brass deflector'),upper),'deflector casting is detached'
assert attached(pick('Forward assist housing'),upper),'forward-assist housing is detached'
assert attached(pick('Forward assist housing'),pick('Forward assist paddle')),'forward-assist button is detached'
# Through-window and hidden/outboard stock storage regressions use the actual
# rendered triangles, not merely component origins or a reference screenshot.
assert tree(pick('A2 tower casting')).ray_cast(Vector((-.05,.106,-.298)),Vector((1,0,0)),.1)[0] is None,'A2 triangular casting window is blocked'
for o in pick('LMT storage tube'):
    lo,hi=bounds([o])
    assert hi[1]<.063 and lo[1]>.042,'storage chambers must sit below the buffer axis inside the cheek shell'
    assert max(abs(lo[0]),abs(hi[0]))<.033,'storage tube protrudes outside the cheek shell'
assert attached(pick('LMT structural web'),pick('LMT SOPMOD body')),'stock web is detached'
assert attached(pick('LMT rear brace'),pick('LMT SOPMOD body')),'stock rear brace is detached'
assert attached(pick('LMT rear brace'),pick('SOPMOD rubber buttpad')),'buttpad has no rear-brace support'
assert tree(pick('LMT structural web')).ray_cast(Vector((-.05,.031,.229)),Vector((1,0,0)),.1)[0] is None,'stock web relief is blocked'
assert attached(pick('MaTech ranging wedge'),pick('MaTech rail base')),'rear ranging mechanism has no base support'
# Side references supersede the previous oblique inference. Test real surfaces,
# including the stock's pad plane and the visible trigger opening/stroke.
pad_tree=tree(pick('SOPMOD rubber buttpad'));pad_hits=[]
for y in (-.025,.005,.030,.055,.080):
    hit=pad_tree.ray_cast(Vector((0,y,.35)),Vector((0,0,-1)),.12)[0]
    assert hit is not None,'stock pad side profile has a hole'
    pad_hits.append(hit.z)
assert max(pad_hits)-min(pad_hits)<.0001,'stock pad is raked rather than square to buffer axis'
assert tree(lower).ray_cast(Vector((-.05,.018,-.022)),Vector((1,0,0)),.1)[0] is None,'receiver side walls hide the trigger window'
assert attached(pick('GI trigger guard'),pick('GI guard mounting ear')),'GI guard is detached from mounting ears'
for ear in pick('GI guard mounting ear'):
    assert attached([ear],lower),'GI guard mounting ear is detached from receiver'
for name in ('Fire','Last_Shot'):
    for frame in range(10):
        pose(name,min(frame/120,.075))
        assert not attached(pick('Curved trigger'),pick('GI trigger guard')),'trigger intersects guard during pull'
pose('Idle')
assert attached(pick('USGI floorplate'),pick('USGI formed aluminum body')),'magazine floorplate is detached from stamped walls'

# Include the fasteners in the handguard exterior, not a shell-only envelope.
guard=pick('RIS II')
lo,hi=bounds(guard);near(hi[2]-lo[2],.31115);near(hi[0]-lo[0],.056642);near(hi[1]-lo[1],.05715)
front=bpy.data.objects['SOCKET_front_post'];sight=bpy.data.objects['SOCKET_sight']
f=CI@front.matrix_world.translation;s=CI@sight.matrix_world.translation
near(f.x,s.x,.00001);near(f.y,s.y,.00001)
rear_tree=tree(rear)
assert rear_tree.ray_cast(Vector((s.x,s.y,s.z+.025)),Vector((0,0,-1)),.045)[0] is None,'rear sight bore is blocked'
for x,y in ((.00275,0),(-.00275,0),(0,.00275),(0,-.00275)):
    assert rear_tree.ray_cast(Vector((s.x+x,s.y+y,s.z+.025)),Vector((0,0,-1)),.045)[0] is None,'5.6 mm gameplay aperture is blocked'
assert rear_tree.ray_cast(Vector((s.x+.00285,s.y,s.z+.025)),Vector((0,0,-1)),.045)[0] is not None,'rear aperture rim is missing'
for x in range(-7,8):
    for y in range(-7,8):
        if math.hypot(x/8,y/8)>.9:continue
        assert rear_tree.ray_cast(Vector((s.x+.0028*x/8,s.y+.0028*y/8,s.z+.025)),Vector((0,0,-1)),.045)[0] is None,'support intrudes into the aperture'
lo,hi=bounds(pick('Front sight post'));near(hi[0]-lo[0],.0026,.000002);near(hi[1]-lo[1],.006858,.000002);near(hi[1],f.y,.000002)
lo,hi=bounds(pick('Front sight tip'));near(hi[0]-lo[0],.00262,.000002);near(hi[1]-lo[1],.001401,.000002);near(hi[1],f.y,.000002)
assert hi[1]-f.y>.0000005,'paint cap coincides with the original metal cap'
assert attached(pick('Front sight tip'),pick('Front sight post')),'green paint tip is detached'
paint=bpy.data.materials['12 | neon-green sight paint']
assert paint.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value==2,'approved tip emission changed'
face=CI@bpy.data.objects['SOCKET_bolt_face'].matrix_world.translation
crown=CI@bpy.data.objects['SOCKET_barrel_crown'].matrix_world.translation
near((face-crown).length,.3683,.00001)
flash=pick('FH556RC');lo,hi=bounds(flash);near(hi[2]-lo[2],.06604)
# The nominal gauge is clear inside the rail. Allow the disclosed polygon chord
# tolerance (.1 mm diameter), not a silent change to the published 29.210 mm.
guard_tree=tree(guard);radius=.014555
# Reference vent cadence is separate from the 10.0076 mm Picatinny teeth.
# A diagonal ray through each lower row center must pass the actual hole.
for cell in range(19):
    z=-.44415+(cell+.5)*.31115/19
    direction=Vector((1,-1,0)).normalized()
    assert guard_tree.ray_cast(Vector((0,.075,z))+direction*.060,-direction,.060)[0] is None,f'RIS II diagonal vent {cell} is blocked'
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
